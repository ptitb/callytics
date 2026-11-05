import type { CallerMatchRule, CallerMatchType } from '../types';

export const CALLER_MATCH_TYPES: Array<{ value: CallerMatchType; label: string }> = [
  { value: 'exact', label: 'Exact number' },
  { value: 'prefix', label: 'Starts with' },
  { value: 'anonymous', label: 'Withheld / not a number' },
];

const BRANCH_KEY_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;
const NUMBER_ENTRY_PATTERN = /^\+?\d[\d\s\-.()]*$/;

/** Branch keys are generated as rule_1, rule_2, ... and never collide with an existing key or "default". */
export function nextCallerMatchBranch(rules: CallerMatchRule[]): string {
  const used = new Set(rules.map((rule) => rule.branch));
  let index = rules.length + 1;
  while (used.has(`rule_${index}`)) {
    index += 1;
  }
  return `rule_${index}`;
}

export function createCallerMatchRule(rules: CallerMatchRule[]): CallerMatchRule {
  return { branch: nextCallerMatchBranch(rules), label: '', match: 'exact', value: '' };
}

/** Reads the rules of a node config. Anything that is not a rule object is dropped. */
export function readCallerMatchRules(config: Record<string, unknown>): CallerMatchRule[] {
  if (!Array.isArray(config.rules)) {
    return [];
  }
  return config.rules
    .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object' && !Array.isArray(entry))
    .map((entry) => ({
      branch: String(entry.branch ?? ''),
      label: String(entry.label ?? ''),
      match: entry.match === 'prefix' || entry.match === 'anonymous' ? entry.match : 'exact',
      value: String(entry.value ?? ''),
    }));
}

/** Text shown on the canvas for a branch: the rule label, or the branch key when there is no label. */
export function callerMatchBranchLabel(rule: CallerMatchRule): string {
  return rule.label.trim() || rule.branch;
}

export function validateCallerMatchBranch(branch: string, rules: CallerMatchRule[], index: number): string | null {
  if (!BRANCH_KEY_PATTERN.test(branch)) {
    return 'Use 1-32 letters, digits, _ or -';
  }
  if (branch === 'default') {
    return 'default is reserved';
  }
  if (rules.some((rule, ruleIndex) => ruleIndex !== index && rule.branch === branch)) {
    return 'Branch key must be unique';
  }
  return null;
}

export function validateCallerMatchValue(rule: CallerMatchRule): string | null {
  if (rule.match === 'anonymous') {
    return null;
  }
  const entries = rule.value.split(/[,\n]/).map((entry) => entry.trim()).filter(Boolean);
  if (entries.length === 0) {
    return 'At least one number is required';
  }
  const invalid = entries.find((entry) => !NUMBER_ENTRY_PATTERN.test(entry));
  return invalid ? `Not a phone number: ${invalid}` : null;
}

/** Lists everything wrong with the rules of a caller_match node, for the save validation. */
export function validateCallerMatchRules(rules: CallerMatchRule[]): string[] {
  if (rules.length === 0) {
    return ['at least one rule is required'];
  }
  const issues: string[] = [];
  rules.forEach((rule, index) => {
    const branchIssue = validateCallerMatchBranch(rule.branch, rules, index);
    if (branchIssue) {
      issues.push(`rule ${index + 1}: ${branchIssue.charAt(0).toLowerCase()}${branchIssue.slice(1)}`);
    }
    const valueIssue = validateCallerMatchValue(rule);
    if (valueIssue) {
      issues.push(`rule ${index + 1}: ${valueIssue.charAt(0).toLowerCase()}${valueIssue.slice(1)}`);
    }
  });
  return issues;
}

interface RoutedEdge {
  source: string;
  sourceHandle?: string | null;
  data?: { branchKey: string | null; condition: string | null } & Record<string, unknown>;
}

/**
 * Keeps the edges of a caller_match node in step with its rules. An edge of a
 * renamed rule follows the new branch key, an edge of a removed rule is dropped.
 * Edges of the default branch and of other nodes are left alone.
 */
export function syncCallerMatchEdges<T extends RoutedEdge>(
  edges: T[],
  nodeId: string,
  rules: CallerMatchRule[],
  rename?: { from: string; to: string },
): T[] {
  const branches = new Set(rules.map((rule) => rule.branch));
  return edges.flatMap((edge) => {
    if (edge.source !== nodeId) {
      return [edge];
    }
    const current = String(edge.data?.condition || edge.sourceHandle || '');
    if (current === 'default') {
      return [edge];
    }
    if (rename && current === rename.from && branches.has(rename.to)) {
      return [{
        ...edge,
        sourceHandle: rename.to,
        data: { ...edge.data, branchKey: rename.to, condition: rename.to } as T['data'],
      }];
    }
    return branches.has(current) ? [edge] : [];
  });
}
