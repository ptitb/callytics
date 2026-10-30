/**
 * Validates a Callytics flow JSON file with the same code the import endpoint runs.
 *
 * Usage: validate.ts <file.json>
 *
 * Hard errors come from the backend (parseFlowDocument, validateNodesConfig, validateEdgesConfig,
 * run for the main flow and every subflow). Everything else is a warning: placeholders the user
 * must fill in and checks that mirror the flow editor, which refuses to save some flows that the
 * import accepts.
 */
import { collectConfigReferences } from '../../backend/src/flows/flow-document';
import type { ParsedFlowDocument, ParsedFlowDocumentSubflow } from '../../backend/src/flows/flow-document';
import { validateEdgesConfig, validateNodesConfig } from '../../backend/src/flows/flows.service';
import { errorMessage, loadFlowDocument } from './load-flow';

const PLACEHOLDER_ID = 999999;
const PLACEHOLDER_TEXT = 'REPLACE-ME';
/** PSTN targets must be digits, so REPLACE-ME is rejected there and this number stands in for it. */
const PLACEHOLDER_PSTN = '+31000000000';

/** Node types the editor does not require an outgoing edge for. */
const NO_OUTGOING_REQUIRED = new Set([
  'hangup', 'group', 'menu', 'play_audio', 'transfer', 'hunt', 'voicemail', 'callback', 'queue_login', 'queue', 'webhook',
]);

interface FlowLevel {
  label: string;
  nodes: ParsedFlowDocument['nodes'];
  edges: ParsedFlowDocument['edges'];
  isSubflow: boolean;
  /** Menu branches of this level that are served by a subflow instead of an edge. */
  subflowBranches: Set<string>;
}

function collectLevels(document: ParsedFlowDocument): FlowLevel[] {
  const levels: FlowLevel[] = [];
  const visit = (
    label: string,
    flow: { nodes: FlowLevel['nodes']; edges: FlowLevel['edges']; subflows: ParsedFlowDocumentSubflow[] },
    isSubflow: boolean,
  ): void => {
    levels.push({
      label,
      nodes: flow.nodes,
      edges: flow.edges,
      isSubflow,
      subflowBranches: new Set(flow.subflows.map((sub) => `${sub.parentNodeKey}::${sub.parentBranchKey}`)),
    });
    flow.subflows.forEach((sub) => visit(`subflow "${sub.name}"`, sub, true));
  };
  visit('main flow', document, false);
  return levels;
}

/** Finds every placeholder text value as `path = value`, e.g. destinations[0].target_value = REPLACE-ME. */
function findPlaceholderText(value: unknown, path: string, found: string[]): void {
  if (typeof value === 'string' && (value.includes(PLACEHOLDER_TEXT) || value === PLACEHOLDER_PSTN)) {
    found.push(`${path} = ${value}`);
  } else if (Array.isArray(value)) {
    value.forEach((entry, index) => findPlaceholderText(entry, `${path}[${index}]`, found));
  } else if (value && typeof value === 'object') {
    for (const [key, entry] of Object.entries(value)) {
      findPlaceholderText(entry, path ? `${path}.${key}` : key, found);
    }
  }
}

function nodeLabel(node: { nodeKey: string; label?: string }): string {
  return node.label ? `${node.nodeKey} ("${node.label}")` : node.nodeKey;
}

function collectPlaceholders(level: FlowLevel): string[] {
  const lines: string[] = [];
  const labelByKey = new Map(level.nodes.map((node) => [node.nodeKey, nodeLabel(node)]));
  for (const reference of collectConfigReferences(level.nodes)) {
    const where = `${level.label}, ${labelByKey.get(reference.nodeKey)}: ${reference.configKey}`;
    lines.push(
      reference.id === PLACEHOLDER_ID
        ? `[fill in] ${where} = ${PLACEHOLDER_ID} (placeholder ${reference.kind} id, select the real one)`
        : `[verify]  ${where} = ${reference.id} (${reference.kind} id, must exist on the target installation)`,
    );
  }
  for (const node of level.nodes) {
    const paths: string[] = [];
    findPlaceholderText(node.config ?? {}, '', paths);
    for (const path of paths) {
      lines.push(`[fill in] ${level.label}, ${nodeLabel(node)}: ${path}`);
    }
  }
  return lines;
}

function isValidTime(value: unknown): value is string {
  return typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value.trim());
}

/** Checks that the flow editor enforces on save or that make a flow misbehave at runtime. */
function collectEditorWarnings(level: FlowLevel): string[] {
  const warnings: string[] = [];
  const nodeKeys = new Set(level.nodes.map((node) => node.nodeKey));
  const outgoing = (nodeKey: string) => level.edges.filter((edge) => edge.sourceNodeKey === nodeKey);
  const prefix = level.label;

  for (const node of level.nodes) {
    const config = (node.config ?? {}) as Record<string, any>;
    const edges = outgoing(node.nodeKey);
    const name = nodeLabel(node);

    if (node.type === 'menu') {
      const branches: string[] = Array.isArray(config.branches) ? config.branches.map(String) : [];
      for (const branch of branches) {
        const routed = edges.some((edge) => (edge.condition ?? edge.branchKey) === branch);
        if (!routed && !level.subflowBranches.has(`${node.nodeKey}::${branch}`)) {
          warnings.push(`${prefix}, ${name}: menu branch "${branch}" has no edge (editor refuses to save)`);
        }
      }
      for (const edge of edges) {
        const key = edge.condition ?? edge.branchKey;
        if (key !== 'complete' && !branches.includes(String(key))) {
          warnings.push(`${prefix}, ${name}: edge for "${key}" is not in config.branches, callers can never take it`);
        }
      }
    }

    if (!NO_OUTGOING_REQUIRED.has(node.type) && edges.length === 0) {
      warnings.push(`${prefix}, ${name}: ${node.type} has no outgoing edge (editor refuses to save)`);
    }

    if (node.type === 'business_hours') {
      for (const result of ['open', 'closed']) {
        if (!edges.some((edge) => (edge.condition ?? edge.branchKey) === result)) {
          warnings.push(`${prefix}, ${name}: no "${result}" edge, a call that gets this result fails`);
        }
      }
      if (!String(config.timezone || '').trim()) {
        warnings.push(`${prefix}, ${name}: empty timezone, this node is always "closed"`);
      }
      for (const [day, entry] of Object.entries<any>(config.schedule ?? {})) {
        if (!entry?.enabled) continue;
        if (!isValidTime(entry.open) || !isValidTime(entry.close) || entry.close <= entry.open) {
          warnings.push(`${prefix}, ${name}: ${day} needs HH:MM open < close (no midnight crossing), otherwise it is always "closed"`);
        }
      }
    }

    if (node.type === 'hunt' && String(config.strategy || 'sequential').toLowerCase() === 'order') {
      const orders = (config.destinations ?? []).map((entry: any) => Number(entry?.order));
      if (orders.some((order: number) => !Number.isInteger(order) || order <= 0) || new Set(orders).size !== orders.length) {
        warnings.push(`${prefix}, ${name}: strategy "order" needs a unique positive integer "order" on every destination (editor refuses to save)`);
      }
    }

    if (['hunt', 'transfer'].includes(node.type) && config.on_no_answer && !nodeKeys.has(String(config.on_no_answer))) {
      warnings.push(`${prefix}, ${name}: on_no_answer "${config.on_no_answer}" is not a node of this flow`);
    }
  }

  const reachable = new Set<string>();
  const queue = level.nodes.filter((node) => node.type === 'start').map((node) => node.nodeKey);
  while (queue.length > 0) {
    const key = queue.pop()!;
    if (reachable.has(key)) continue;
    reachable.add(key);
    outgoing(key).forEach((edge) => queue.push(edge.targetNodeKey));
    const source = level.nodes.find((node) => node.nodeKey === key);
    const onNoAnswer = (source?.config as Record<string, unknown> | undefined)?.on_no_answer;
    if (onNoAnswer) queue.push(String(onNoAnswer));
  }
  for (const node of level.nodes) {
    if (node.type !== 'group' && !reachable.has(node.nodeKey)) {
      warnings.push(`${prefix}, ${nodeLabel(node)}: not reachable from start`);
    }
  }

  const real = level.nodes.filter((node) => node.type !== 'group');
  const start = real.find((node) => node.type === 'start');
  const hangup = real.find((node) => node.type === 'hangup');
  if (
    !level.isSubflow && real.length === 2 && level.edges.length === 1 && start && hangup
    && level.edges[0].sourceNodeKey === start.nodeKey && level.edges[0].targetNodeKey === hangup.nodeKey
  ) {
    warnings.push(`${prefix}: hangs up on every caller, the editor refuses to publish it`);
  }
  return warnings;
}

function main(): number {
  const file = process.argv[2];
  if (!file) {
    console.error('Usage: validate <file.json>');
    return 2;
  }

  let document: ParsedFlowDocument;
  let levels: FlowLevel[];
  try {
    document = loadFlowDocument(file);
    levels = collectLevels(document);
    for (const level of levels) {
      try {
        validateNodesConfig(level.nodes, { isSubflow: level.isSubflow });
        validateEdgesConfig(level.edges, level.nodes);
      } catch (error) {
        throw new Error(`${level.label}: ${errorMessage(error)}`);
      }
    }
  } catch (error) {
    console.error(`INVALID: ${errorMessage(error)}`);
    return 1;
  }

  const nodeCount = levels.reduce((sum, level) => sum + level.nodes.length, 0);
  const edgeCount = levels.reduce((sum, level) => sum + level.edges.length, 0);
  console.log(
    `OK: "${document.name}", ${nodeCount} nodes, ${edgeCount} edges, ${levels.length - 1} subflows. `
    + 'The import endpoint accepts this file.',
  );

  const placeholders = levels.flatMap(collectPlaceholders);
  if (placeholders.length > 0) {
    console.log(`\nFill in after import (${placeholders.length}):`);
    placeholders.forEach((line) => console.log(`  ${line}`));
  }

  const warnings = levels.flatMap(collectEditorWarnings);
  if (warnings.length > 0) {
    console.log(`\nWarnings (${warnings.length}):`);
    warnings.forEach((line) => console.log(`  ${line}`));
  }
  return 0;
}

process.exit(main());
