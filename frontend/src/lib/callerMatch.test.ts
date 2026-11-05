import { describe, it, expect } from 'vitest';
import type { CallerMatchRule } from '../types';
import {
  callerMatchBranchLabel,
  createCallerMatchRule,
  nextCallerMatchBranch,
  readCallerMatchRules,
  syncCallerMatchEdges,
  validateCallerMatchBranch,
  validateCallerMatchRules,
  validateCallerMatchValue,
} from './callerMatch';

const rule = (overrides: Partial<CallerMatchRule> = {}): CallerMatchRule => ({
  branch: 'vip',
  label: 'VIP customer',
  match: 'exact',
  value: '+31612345678',
  ...overrides,
});

describe('readCallerMatchRules', () => {
  it('returns an empty list when rules are missing or not an array', () => {
    expect(readCallerMatchRules({})).toEqual([]);
    expect(readCallerMatchRules({ rules: 'x' })).toEqual([]);
  });

  it('drops entries that are not objects and fills in defaults', () => {
    expect(readCallerMatchRules({ rules: [null, 'x', { branch: 'a' }] })).toEqual([
      { branch: 'a', label: '', match: 'exact', value: '' },
    ]);
  });
});

describe('createCallerMatchRule', () => {
  it('generates branch keys that do not collide', () => {
    expect(nextCallerMatchBranch([])).toBe('rule_1');
    expect(nextCallerMatchBranch([rule({ branch: 'rule_2' })])).toBe('rule_3');
    expect(createCallerMatchRule([]).match).toBe('exact');
  });
});

describe('callerMatchBranchLabel', () => {
  it('uses the label and falls back to the branch key', () => {
    expect(callerMatchBranchLabel(rule())).toBe('VIP customer');
    expect(callerMatchBranchLabel(rule({ label: '  ' }))).toBe('vip');
  });
});

describe('validateCallerMatchBranch', () => {
  const rules = [rule({ branch: 'a' }), rule({ branch: 'b' })];

  it('accepts letters, digits, _ and -', () => {
    expect(validateCallerMatchBranch('vip_1-x', rules, 0)).toBeNull();
  });

  it.each(['', 'has space', 'a'.repeat(33), 'ä'])('rejects %p', (branch) => {
    expect(validateCallerMatchBranch(branch, rules, 0)).toMatch(/1-32/);
  });

  it('rejects default and duplicates', () => {
    expect(validateCallerMatchBranch('default', rules, 0)).toMatch(/reserved/);
    expect(validateCallerMatchBranch('b', rules, 0)).toMatch(/unique/);
    expect(validateCallerMatchBranch('a', rules, 0)).toBeNull();
  });
});

describe('validateCallerMatchValue', () => {
  it('accepts number lists separated by commas and newlines', () => {
    expect(validateCallerMatchValue(rule({ value: '+31612345678, 06 12 34 56 78\n0031(0)20' }))).toBeNull();
  });

  it('requires a number unless the rule matches anonymous callers', () => {
    expect(validateCallerMatchValue(rule({ value: ' ' }))).toMatch(/required/);
    expect(validateCallerMatchValue(rule({ match: 'anonymous', value: '' }))).toBeNull();
  });

  it('names the entry that is not a number', () => {
    expect(validateCallerMatchValue(rule({ match: 'prefix', value: '+31, abc' }))).toMatch(/abc/);
  });
});

describe('validateCallerMatchRules', () => {
  it('requires at least one rule', () => {
    expect(validateCallerMatchRules([])).toEqual(['at least one rule is required']);
  });

  it('reports the problems per rule', () => {
    const issues = validateCallerMatchRules([rule({ branch: 'a' }), rule({ branch: 'a', value: '' })]);
    expect(issues).toEqual([
      'rule 1: branch key must be unique',
      'rule 2: branch key must be unique',
      'rule 2: at least one number is required',
    ]);
  });

  it('returns no issues for valid rules', () => {
    expect(validateCallerMatchRules([rule(), rule({ branch: 'anon', match: 'anonymous', value: '' })])).toEqual([]);
  });
});

describe('syncCallerMatchEdges', () => {
  const edge = (source: string, condition: string | null) => ({
    source,
    sourceHandle: condition,
    data: { branchKey: condition, condition },
  });
  const rules = [rule({ branch: 'vip2' })];

  it('renames the edge of a renamed rule', () => {
    const [renamed] = syncCallerMatchEdges([edge('cm', 'vip')], 'cm', rules, { from: 'vip', to: 'vip2' });
    expect(renamed.sourceHandle).toBe('vip2');
    expect(renamed.data).toEqual({ branchKey: 'vip2', condition: 'vip2' });
  });

  it('drops the edge of a removed rule', () => {
    expect(syncCallerMatchEdges([edge('cm', 'gone')], 'cm', rules)).toEqual([]);
  });

  it('keeps default edges, edges of other nodes and edges of existing rules', () => {
    const edges = [edge('cm', 'default'), edge('other', 'gone'), edge('cm', 'vip2')];
    expect(syncCallerMatchEdges(edges, 'cm', rules)).toEqual(edges);
  });
});
