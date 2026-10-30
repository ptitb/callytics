/**
 * Walks a Callytics flow the way the stasis runtime would and prints the path.
 *
 * Usage:
 *   simulate.ts <file.json> --at <ISO datetime> [--tz <IANA zone>] [--digits 1,2] [--hunt answered|no-answer]
 *
 * Uses the real edge resolver and business hours evaluation from stasis. It does NOT play audio,
 * talk to Asterisk, dial anyone, or touch a database. Per node type it assumes:
 *   business_hours  evaluated against --at
 *   menu, get_digits consume the digits from --digits in order (no digit left means the caller times out)
 *   hunt, transfer  --hunt answered gives "done", --hunt no-answer follows on_no_answer (default: no-answer)
 *   queue           --hunt answered gives "connected", otherwise "timeout"
 *   other nodes     their normal result ("default", or "done" for terminal nodes)
 */
import type { ParsedFlowDocument } from '../../backend/src/flows/flow-document';
import { evaluateBusinessHours } from '../../stasis/src/executors/business_hours.executor';
import { resolveNextEdge } from '../../stasis/src/engine/edgeResolver';
import { errorMessage, loadFlowDocument } from './load-flow';

const MAX_STEPS = 200;
const DEFAULT_MENU_ATTEMPTS = 3;

type FlowNode = ParsedFlowDocument['nodes'][number];
type FlowEdge = ParsedFlowDocument['edges'][number];

/** Same node types the stasis runtime reroutes after a completed call, see isPostCompletionRoutableNode. */
const POST_COMPLETION_ROUTABLE = new Set(['voicemail', 'callback', 'transfer', 'hunt']);

interface Options {
  file: string;
  at: Date;
  digits: string[];
  huntAnswered: boolean;
}

interface Level {
  name: string;
  nodes: FlowNode[];
  edges: Array<{ sourceNodeKey: string; targetNodeKey: string; branchKey: string; condition: string | null }>;
  subflows: Array<{ parentNodeKey: string; parentBranchKey: string; level: Level }>;
}

function toLevel(name: string, flow: { nodes: FlowNode[]; edges: FlowEdge[]; subflows: any[] }): Level {
  return {
    name,
    nodes: flow.nodes,
    // The runtime loads edges from the database where a missing condition is null.
    edges: flow.edges.map((edge) => ({
      sourceNodeKey: edge.sourceNodeKey,
      targetNodeKey: edge.targetNodeKey,
      branchKey: edge.branchKey ?? 'default',
      condition: edge.condition ?? null,
    })),
    subflows: flow.subflows.map((sub) => ({
      parentNodeKey: sub.parentNodeKey,
      parentBranchKey: sub.parentBranchKey,
      level: toLevel(sub.name, sub),
    })),
  };
}

/** Offset in ms between UTC and the given zone at the given instant. */
function zoneOffsetMs(instant: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(instant));
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return asUtc - Math.floor(instant / 1000) * 1000;
}

/** Parses --at. A string without offset is read as wall time in --tz. */
function parseAt(value: string, timeZone: string | undefined): Date {
  const hasOffset = /(Z|[+-]\d{2}:?\d{2})$/i.test(value);
  if (hasOffset) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) throw new Error(`Invalid --at value "${value}"`);
    return date;
  }
  if (!timeZone) {
    throw new Error('--at has no UTC offset. Add one (2026-11-03T10:00:00+01:00) or pass --tz Europe/Amsterdam.');
  }
  const wall = new Date(`${value}Z`);
  if (Number.isNaN(wall.getTime())) throw new Error(`Invalid --at value "${value}"`);
  const firstGuess = wall.getTime() - zoneOffsetMs(wall.getTime(), timeZone);
  return new Date(wall.getTime() - zoneOffsetMs(firstGuess, timeZone));
}

function parseArgs(argv: string[]): Options {
  const file = argv[0];
  if (!file || file.startsWith('--')) {
    throw new Error('Usage: simulate <file.json> --at <ISO datetime> [--tz <zone>] [--digits 1,2] [--hunt answered|no-answer]');
  }
  const flag = (name: string): string | undefined => {
    const index = argv.indexOf(`--${name}`);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  const at = flag('at');
  if (!at) throw new Error('--at <ISO datetime> is required');
  const hunt = flag('hunt') ?? 'no-answer';
  if (!['answered', 'no-answer'].includes(hunt)) throw new Error('--hunt must be answered or no-answer');
  return {
    file,
    at: parseAt(at, flag('tz')),
    digits: (flag('digits') ?? '').split(',').map((digit) => digit.trim()).filter(Boolean),
    huntAnswered: hunt === 'answered',
  };
}

function describeTime(at: Date, timeZone: string): string {
  return `${at.toLocaleString('en-GB', { timeZone, weekday: 'long', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })} ${timeZone}`;
}

function simulate(document: ParsedFlowDocument, options: Options): void {
  const root = toLevel(document.name, document);
  const digits = [...options.digits];
  const stack: Array<{ level: Level; menuNodeKey: string }> = [];
  let level = root;
  let nodeKey: string | undefined = level.nodes.find((node) => node.type === 'start')?.nodeKey ?? level.nodes[0]?.nodeKey;
  const menuAttempts = new Map<string, number>();

  console.log(`Simulating "${document.name}" at ${options.at.toISOString()}`);
  console.log(`Digits: [${options.digits.join(', ')}], hunt/transfer/queue: ${options.huntAnswered ? 'answered' : 'no answer'}\n`);

  const outcome = (text: string): void => console.log(`\nEnd: ${text}`);

  /** Returns false when the call ends, otherwise moves to the parent flow's "complete" edge. */
  const returnToParent = (): boolean => {
    const frame = stack.pop();
    if (!frame) return false;
    level = frame.level;
    const edge = resolveNextEdge(frame.menuNodeKey, 'menu', 'complete', level.edges);
    if (!edge) return false;
    console.log(`     back in "${level.name}", menu ${frame.menuNodeKey} -> complete`);
    nodeKey = edge.targetNodeKey;
    return true;
  };

  for (let step = 1; step <= MAX_STEPS; step += 1) {
    const node = level.nodes.find((candidate) => candidate.nodeKey === nodeKey);
    if (!node) {
      outcome(`FAILED, node "${nodeKey}" does not exist in "${level.name}"`);
      return;
    }
    const config = (node.config ?? {}) as Record<string, any>;
    const where = `${step}. ${node.nodeKey} [${node.type}]${node.label ? ` "${node.label}"` : ''}`;
    let result = 'default';
    let note = '';

    switch (node.type) {
      case 'business_hours':
        result = evaluateBusinessHours(config, options.at);
        note = ` (${describeTime(options.at, String(config.timezone || 'UTC'))})`;
        break;
      case 'menu': {
        const branches: string[] = (config.branches ?? []).map(String);
        const maxInvalid = Math.max(1, Number(config.max_invalid_attempts) || DEFAULT_MENU_ATTEMPTS);
        result = 'hangup';
        for (;;) {
          const digit = digits.shift();
          if (digit === undefined) {
            note = ' (no digit left: caller times out, menu plays final failure audio and hangs up)';
            break;
          }
          if (branches.includes(digit)) {
            result = digit;
            note = ` (digit ${digit})`;
            break;
          }
          const attempts = (menuAttempts.get(node.nodeKey) ?? 0) + 1;
          menuAttempts.set(node.nodeKey, attempts);
          console.log(`${where}: digit "${digit}" is not a branch (invalid attempt ${attempts}/${maxInvalid})`);
          if (attempts >= maxInvalid) {
            note = ' (too many invalid digits: final failure audio, hangs up)';
            break;
          }
        }
        break;
      }
      case 'get_digits': {
        const digit = digits.shift();
        result = digit ?? 'timeout';
        note = digit === undefined ? ' (no digit left: timeout)' : ` (digit ${digit})`;
        break;
      }
      case 'hunt':
      case 'transfer':
        if (options.huntAnswered) {
          result = 'done';
          note = ' (answered, call ends when the conversation ends)';
        } else {
          result = config.on_no_answer ? `route:${config.on_no_answer}` : 'hangup';
          note = ' (no answer)';
        }
        break;
      case 'queue':
        result = options.huntAnswered ? 'connected' : 'timeout';
        break;
      case 'queue_login':
        result = 'authenticated';
        break;
      case 'voicemail':
      case 'callback':
      case 'hangup':
        result = 'done';
        break;
      default:
        result = 'default';
    }

    const webhooks = level.edges
      .filter((edge) => edge.sourceNodeKey === node.nodeKey)
      .map((edge) => level.nodes.find((candidate) => candidate.nodeKey === edge.targetNodeKey))
      .filter((target) => target?.type === 'webhook');
    const webhookNote = webhooks.length > 0 ? ` [webhooks: ${webhooks.map((target) => target!.nodeKey).join(', ')}]` : '';

    if (result === 'authenticated') {
      console.log(`${where} -> ${result}${note}`);
      outcome('queue login authenticated (terminal)');
      return;
    }

    if (result === 'done' && POST_COMPLETION_ROUTABLE.has(node.type)) {
      const routing = level.edges.filter(
        (edge) => edge.sourceNodeKey === node.nodeKey
          && level.nodes.find((candidate) => candidate.nodeKey === edge.targetNodeKey)?.type !== 'webhook',
      );
      const next = resolveNextEdge(node.nodeKey, node.type, result, routing);
      if (next) {
        console.log(`${where} -> done${note}, follows edge to ${next.targetNodeKey}${webhookNote}`);
        nodeKey = next.targetNodeKey;
        continue;
      }
    }

    if (result === 'done' || result === 'hangup') {
      console.log(`${where} -> ${result}${note}${webhookNote}`);
      if (returnToParent()) continue;
      outcome(node.type === 'hangup' ? 'hangup node' : `call ends after ${node.type}`);
      return;
    }

    if (result.startsWith('route:')) {
      const target = result.slice('route:'.length);
      console.log(`${where} -> ${result}${note}${webhookNote}`);
      nodeKey = target;
      continue;
    }

    const routing = level.edges.filter(
      (edge) => edge.sourceNodeKey === node.nodeKey
        && level.nodes.find((candidate) => candidate.nodeKey === edge.targetNodeKey)?.type !== 'webhook',
    );
    const edge = resolveNextEdge(node.nodeKey, node.type, result, routing);
    if (!edge) {
      console.log(`${where} -> ${result}${note}${webhookNote}`);
      const sub = node.type === 'menu' ? level.subflows.find((entry) => entry.parentNodeKey === node.nodeKey && entry.parentBranchKey === result) : undefined;
      if (sub) {
        console.log(`     enters submenu "${sub.level.name}"`);
        stack.push({ level, menuNodeKey: node.nodeKey });
        level = sub.level;
        nodeKey = level.nodes.find((candidate) => candidate.type === 'start')?.nodeKey ?? level.nodes[0]?.nodeKey;
        continue;
      }
      if (node.type === 'play_audio') {
        outcome('dead end after play_audio, the runtime hangs up');
      } else if (!returnToParent()) {
        outcome(`FAILED, no edge from ${node.nodeKey} (${node.type}) for result "${result}"`);
        return;
      }
      if (node.type === 'play_audio') return;
      continue;
    }

    console.log(`${where} -> ${result}${note}, edge to ${edge.targetNodeKey}${webhookNote}`);
    nodeKey = edge.targetNodeKey;
  }
  outcome(`stopped after ${MAX_STEPS} steps, the flow probably loops`);
}

function main(): number {
  try {
    const options = parseArgs(process.argv.slice(2));
    simulate(loadFlowDocument(options.file), options);
    return 0;
  } catch (error) {
    console.error(errorMessage(error));
    return 1;
  }
}

process.exit(main());
