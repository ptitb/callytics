import { BadRequestException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync, ValidationError } from 'class-validator';
import { FlowEdgeDto } from './dto/flow-edge.dto';
import { FlowNodeDto } from './dto/flow-node.dto';

/**
 * Portable flow document used for export and import.
 *
 * The document never contains database ids. Submenus are separate flows in the
 * database; in the document they are nested under `subflows` and linked to their
 * parent only by `parentNodeKey` + `parentBranchKey`.
 */
export const FLOW_DOCUMENT_FORMAT = 'callytics-flow';
export const FLOW_DOCUMENT_VERSION = 1;
export const DEFAULT_IMPORT_FLOW_NAME = 'Imported Flow';

const MAX_SUBFLOW_DEPTH = 10;
const MAX_REPORTED_ERRORS = 10;
const MENU_BRANCH_PATTERN = /^(?:\d{1,2}|\*|#)$/;

export interface FlowDocumentNode {
  nodeKey: string;
  type: string;
  label?: string;
  config: Record<string, unknown>;
  positionX: number;
  positionY: number;
  groupId?: string;
}

export interface FlowDocumentEdge {
  sourceNodeKey: string;
  targetNodeKey: string;
  branchKey: string;
  condition?: string;
  sourceHandle?: string;
  targetHandle?: string;
}

export interface FlowDocumentSubflow {
  parentNodeKey: string;
  parentBranchKey: string;
  name: string;
  nodes: FlowDocumentNode[];
  edges: FlowDocumentEdge[];
  subflows?: FlowDocumentSubflow[];
}

export interface FlowExportDocument {
  format: typeof FLOW_DOCUMENT_FORMAT;
  version: typeof FLOW_DOCUMENT_VERSION;
  exportedAt: string;
  name: string;
  description?: string;
  nodes: FlowDocumentNode[];
  edges: FlowDocumentEdge[];
  subflows?: FlowDocumentSubflow[];
}

/** Flow data as stored in the database, input for {@link buildExportDocument}. */
export interface FlowExportSource {
  name: string;
  description?: string | null;
  nodes: Array<{
    nodeKey: string;
    type: string;
    label?: string | null;
    config?: Record<string, unknown> | null;
    positionX?: number | null;
    positionY?: number | null;
    groupId?: string | null;
  }>;
  edges: Array<{
    sourceNodeKey: string;
    targetNodeKey: string;
    branchKey?: string | null;
    condition?: string | null;
    sourceHandle?: string | null;
    targetHandle?: string | null;
  }>;
  subflows?: Array<{
    parentNodeKey: string;
    parentBranchKey: string;
    flow: FlowExportSource;
  }>;
}

function omitEmpty<T extends Record<string, unknown>>(value: T): T {
  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry !== null && entry !== undefined) {
      result[key] = entry;
    }
  }
  return result as T;
}

function buildNodes(nodes: FlowExportSource['nodes']): FlowDocumentNode[] {
  return nodes.map((node) => omitEmpty({
    nodeKey: node.nodeKey,
    type: node.type,
    label: node.label,
    config: node.config ?? {},
    positionX: node.positionX ?? 0,
    positionY: node.positionY ?? 0,
    groupId: node.groupId,
  }) as FlowDocumentNode);
}

function buildEdges(edges: FlowExportSource['edges']): FlowDocumentEdge[] {
  return edges.map((edge) => omitEmpty({
    sourceNodeKey: edge.sourceNodeKey,
    targetNodeKey: edge.targetNodeKey,
    branchKey: edge.branchKey ?? 'default',
    condition: edge.condition,
    sourceHandle: edge.sourceHandle,
    targetHandle: edge.targetHandle,
  }) as FlowDocumentEdge);
}

function buildSubflows(subflows: FlowExportSource['subflows']): FlowDocumentSubflow[] {
  return (subflows ?? []).map((entry) => {
    const nested = buildSubflows(entry.flow.subflows);
    return {
      parentNodeKey: entry.parentNodeKey,
      parentBranchKey: entry.parentBranchKey,
      name: entry.flow.name,
      nodes: buildNodes(entry.flow.nodes),
      edges: buildEdges(entry.flow.edges),
      ...(nested.length > 0 ? { subflows: nested } : {}),
    };
  });
}

/** Builds the portable export document. Contains no database ids and omits null fields. */
export function buildExportDocument(source: FlowExportSource, exportedAt: Date = new Date()): FlowExportDocument {
  const subflows = buildSubflows(source.subflows);
  const description = source.description?.trim();
  return {
    format: FLOW_DOCUMENT_FORMAT,
    version: FLOW_DOCUMENT_VERSION,
    exportedAt: exportedAt.toISOString(),
    name: source.name,
    ...(description ? { description } : {}),
    nodes: buildNodes(source.nodes),
    edges: buildEdges(source.edges),
    ...(subflows.length > 0 ? { subflows } : {}),
  };
}

export interface ParsedFlowDocumentSubflow {
  parentNodeKey: string;
  parentBranchKey: string;
  name: string;
  nodes: FlowNodeDto[];
  edges: FlowEdgeDto[];
  subflows: ParsedFlowDocumentSubflow[];
}

export interface ParsedFlowDocument {
  name: string;
  description?: string;
  nodes: FlowNodeDto[];
  edges: FlowEdgeDto[];
  subflows: ParsedFlowDocumentSubflow[];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function pick(source: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key of keys) {
    // null and undefined both mean "not set"; this keeps the DTO instances clean.
    if (source[key] !== undefined && source[key] !== null) {
      result[key] = source[key];
    }
  }
  return result;
}

function flattenValidationErrors(errors: ValidationError[]): string[] {
  return errors.flatMap((error) => Object.values(error.constraints ?? {}));
}

function sanitizeItems<T extends object>(
  items: unknown,
  path: string,
  cls: new () => T,
  keys: string[],
  errors: string[],
  describe: (item: Record<string, unknown>) => string,
): T[] {
  const result: T[] = [];
  (items as unknown[]).forEach((item, index) => {
    const label = `${path}[${index}]`;
    if (!isPlainObject(item)) {
      errors.push(`${label} must be an object`);
      return;
    }
    const instance = plainToInstance(cls, pick(item, keys));
    const messages = flattenValidationErrors(validateSync(instance, { whitelist: true }));
    for (const message of messages) {
      errors.push(`${label}${describe(item)}: ${message}`);
    }
    result.push(instance);
  });
  return result;
}

const NODE_KEYS = ['nodeKey', 'type', 'label', 'positionX', 'positionY', 'config', 'groupId'];
const EDGE_KEYS = ['sourceNodeKey', 'targetNodeKey', 'branchKey', 'condition', 'sourceHandle', 'targetHandle'];

function parseFlowLevel(
  raw: Record<string, unknown>,
  path: string,
  depth: number,
  errors: string[],
): { nodes: FlowNodeDto[]; edges: FlowEdgeDto[]; subflows: ParsedFlowDocumentSubflow[] } {
  const empty = { nodes: [], edges: [], subflows: [] };
  const nodesPath = path ? `${path}.nodes` : 'nodes';
  const edgesPath = path ? `${path}.edges` : 'edges';

  if (!Array.isArray(raw.nodes) || raw.nodes.length === 0) {
    errors.push(`${nodesPath} must be a non-empty array`);
    return empty;
  }
  if (raw.edges !== undefined && raw.edges !== null && !Array.isArray(raw.edges)) {
    errors.push(`${edgesPath} must be an array`);
    return empty;
  }

  const nodes = sanitizeItems(
    raw.nodes,
    nodesPath,
    FlowNodeDto,
    NODE_KEYS,
    errors,
    (item) => (typeof item.nodeKey === 'string' ? ` (${item.nodeKey})` : ''),
  );
  const edges = sanitizeItems(
    (raw.edges as unknown[] | undefined | null) ?? [],
    edgesPath,
    FlowEdgeDto,
    EDGE_KEYS,
    errors,
    () => '',
  );

  const nodeKeys = new Set<string>();
  for (const node of nodes) {
    if (typeof node.nodeKey !== 'string') {
      continue;
    }
    if (nodeKeys.has(node.nodeKey)) {
      errors.push(`${nodesPath}: duplicate nodeKey "${node.nodeKey}"`);
    }
    nodeKeys.add(node.nodeKey);
  }
  edges.forEach((edge, index) => {
    if (typeof edge.sourceNodeKey === 'string' && !nodeKeys.has(edge.sourceNodeKey)) {
      errors.push(`${edgesPath}[${index}]: source node "${edge.sourceNodeKey}" does not exist`);
    }
    if (typeof edge.targetNodeKey === 'string' && !nodeKeys.has(edge.targetNodeKey)) {
      errors.push(`${edgesPath}[${index}]: target node "${edge.targetNodeKey}" does not exist`);
    }
  });

  const subflows = parseSubflows(raw.subflows, path, nodes, depth, errors);
  return { nodes, edges, subflows };
}

function parseSubflows(
  rawSubflows: unknown,
  path: string,
  parentNodes: FlowNodeDto[],
  depth: number,
  errors: string[],
): ParsedFlowDocumentSubflow[] {
  const subflowsPath = path ? `${path}.subflows` : 'subflows';
  if (rawSubflows === undefined || rawSubflows === null) {
    return [];
  }
  if (!Array.isArray(rawSubflows)) {
    errors.push(`${subflowsPath} must be an array`);
    return [];
  }
  if (depth >= MAX_SUBFLOW_DEPTH) {
    errors.push(`${subflowsPath}: submenus are nested deeper than ${MAX_SUBFLOW_DEPTH} levels`);
    return [];
  }

  const parsed: ParsedFlowDocumentSubflow[] = [];
  const usedLinks = new Set<string>();
  rawSubflows.forEach((rawSubflow, index) => {
    const label = `${subflowsPath}[${index}]`;
    if (!isPlainObject(rawSubflow)) {
      errors.push(`${label} must be an object`);
      return;
    }

    const parentNodeKey = typeof rawSubflow.parentNodeKey === 'string' ? rawSubflow.parentNodeKey : '';
    const parentBranchKey = typeof rawSubflow.parentBranchKey === 'string' ? rawSubflow.parentBranchKey.trim() : '';
    const parentNode = parentNodes.find((node) => node.nodeKey === parentNodeKey);
    if (!parentNodeKey) {
      errors.push(`${label}: parentNodeKey is required`);
    } else if (!parentNode) {
      errors.push(`${label}: parentNodeKey "${parentNodeKey}" does not match a node of the parent flow`);
    } else if (parentNode.type !== 'menu') {
      errors.push(`${label}: parentNodeKey "${parentNodeKey}" must be a menu node`);
    }
    if (!MENU_BRANCH_PATTERN.test(parentBranchKey)) {
      errors.push(`${label}: parentBranchKey must be 1-2 digits, * or #`);
    }
    const linkKey = `${parentNodeKey}\u0000${parentBranchKey}`;
    if (usedLinks.has(linkKey)) {
      errors.push(`${label}: duplicate submenu for node "${parentNodeKey}" branch "${parentBranchKey}"`);
    }
    usedLinks.add(linkKey);

    const level = parseFlowLevel(rawSubflow, label, depth + 1, errors);
    const name = typeof rawSubflow.name === 'string' && rawSubflow.name.trim()
      ? rawSubflow.name.trim()
      : `Submenu ${parentNodeKey} ${parentBranchKey}`.trim();
    parsed.push({ parentNodeKey, parentBranchKey, name, ...level });
  });
  return parsed;
}

/**
 * Turns an untrusted JSON body into validated flow DTOs.
 *
 * Accepts the export format, a minimal `{ name, nodes, edges }` document and the
 * response shape of `GET /flows/:id`. Fields that are not part of the portable
 * format (database ids, `subflowId`, `versionId`, ...) are dropped, not rejected.
 * Throws a 400 with all collected problems in one message.
 */
export function parseFlowDocument(raw: unknown): ParsedFlowDocument {
  if (!isPlainObject(raw)) {
    throw new BadRequestException('Flow document must be a JSON object');
  }

  const errors: string[] = [];
  if (raw.format !== undefined && raw.format !== FLOW_DOCUMENT_FORMAT) {
    throw new BadRequestException(`Unsupported format "${String(raw.format)}", expected "${FLOW_DOCUMENT_FORMAT}"`);
  }
  if (raw.version !== undefined && raw.version !== FLOW_DOCUMENT_VERSION) {
    throw new BadRequestException(`Unsupported version "${String(raw.version)}", expected ${FLOW_DOCUMENT_VERSION}`);
  }
  if (raw.name !== undefined && raw.name !== null && typeof raw.name !== 'string') {
    errors.push('name must be a string');
  }
  if (raw.description !== undefined && raw.description !== null && typeof raw.description !== 'string') {
    errors.push('description must be a string');
  }

  const level = parseFlowLevel(raw, '', 0, errors);
  if (errors.length > 0) {
    const shown = errors.slice(0, MAX_REPORTED_ERRORS);
    const hidden = errors.length - shown.length;
    throw new BadRequestException(
      `Invalid flow document: ${shown.join('; ')}${hidden > 0 ? `; and ${hidden} more` : ''}`,
    );
  }

  const name = typeof raw.name === 'string' ? raw.name.trim() : '';
  const description = typeof raw.description === 'string' && raw.description.trim()
    ? raw.description.trim()
    : undefined;
  return {
    name: name || DEFAULT_IMPORT_FLOW_NAME,
    ...(description ? { description } : {}),
    ...level,
  };
}

export type ConfigReferenceKind = 'audio file' | 'trunk' | 'queue' | 'operator' | 'extension';

export interface ConfigReference {
  nodeKey: string;
  configKey: string;
  kind: ConfigReferenceKind;
  id: number;
}

const TRUNK_ID_KEYS = new Set(['trunk_id', 'trunkId', 'destination_trunk_id']);
const AUDIO_ID_KEY = /(?:^|_)audio(?:_file)?_id$/;

function toPositiveId(value: unknown): number | null {
  const numeric = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
  return Number.isInteger(numeric) && numeric > 0 ? numeric : null;
}

function collectFromObject(
  nodeKey: string,
  config: Record<string, unknown>,
  prefix: string,
  references: ConfigReference[],
): void {
  const push = (kind: ConfigReferenceKind, key: string, value: unknown): void => {
    const id = toPositiveId(value);
    if (id !== null) {
      references.push({ nodeKey, configKey: `${prefix}${key}`, kind, id });
    }
  };

  for (const [key, value] of Object.entries(config)) {
    if (AUDIO_ID_KEY.test(key)) {
      push('audio file', key, value);
    } else if (TRUNK_ID_KEYS.has(key)) {
      push('trunk', key, value);
    } else if (key === 'queue_id') {
      push('queue', key, value);
    } else if (key === 'queue_ids' && Array.isArray(value)) {
      value.forEach((entry) => push('queue', key, entry));
    } else if (key === 'operator_id') {
      push('operator', key, value);
    } else if (key === 'moderatorId') {
      push(config.moderatorType === 'pstn' ? 'operator' : 'extension', key, value);
    } else if ((key === 'destinations' || key === 'participants') && Array.isArray(value)) {
      value.forEach((entry, index) => {
        if (isPlainObject(entry)) {
          collectFromObject(nodeKey, entry, `${prefix}${key}[${index}].`, references);
        }
      });
    }
  }
}

/**
 * Lists every config value that points at another database row.
 *
 * Keys come from the node executors in stasis/src: `*audio_file_id` and `*audio_id`,
 * `trunk_id`, `trunkId`, `destination_trunk_id`, `queue_id`, `queue_ids`, `operator_id`
 * and `moderatorId` (an operator for PSTN moderators, otherwise an extension),
 * including entries of `destinations` and `participants`.
 */
export function collectConfigReferences(nodes: Array<Pick<FlowNodeDto, 'nodeKey' | 'config'>>): ConfigReference[] {
  const references: ConfigReference[] = [];
  for (const node of nodes) {
    if (node.config) {
      collectFromObject(node.nodeKey, node.config, '', references);
    }
  }
  return references;
}

export function formatMissingReferenceWarning(reference: ConfigReference, flowName: string): string {
  return `${flowName}, node "${reference.nodeKey}": ${reference.kind} ${reference.id} (${reference.configKey}) does not exist on this installation`;
}
