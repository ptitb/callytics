import { useEffect, useState } from 'react';
import type { CallerMatchRule, CallerMatchType } from '../../types';
import {
  CALLER_MATCH_TYPES,
  createCallerMatchRule,
  readCallerMatchRules,
  validateCallerMatchBranch,
  validateCallerMatchValue,
} from '../../lib/callerMatch';
import styles from './CallerMatchConfigPanel.module.css';

export interface CallerMatchRename {
  from: string;
  to: string;
}

interface CallerMatchConfigPanelProps {
  nodeId: string;
  config: Record<string, unknown>;
  /** Show the validation messages, used after a failed save attempt. */
  saveAttempted?: boolean;
  /** `rename` is set when the branch key of one rule changed, so its edge can follow. */
  onRulesChange: (rules: CallerMatchRule[], rename?: CallerMatchRename) => void;
}

interface RuleRowProps {
  rule: CallerMatchRule;
  index: number;
  rules: CallerMatchRule[];
  showValueErrors: boolean;
  onChange: (index: number, next: CallerMatchRule, rename?: CallerMatchRename) => void;
  onMove: (index: number, direction: -1 | 1) => void;
  onRemove: (index: number) => void;
}

function RuleRow({ rule, index, rules, showValueErrors, onChange, onMove, onRemove }: RuleRowProps) {
  // The branch key is only committed while it is valid, so an edge never follows a half typed key.
  const [branchDraft, setBranchDraft] = useState(rule.branch);
  useEffect(() => setBranchDraft(rule.branch), [rule.branch]);

  const branchError = validateCallerMatchBranch(branchDraft, rules, index);
  const valueError = showValueErrors ? validateCallerMatchValue(rule) : null;

  const handleBranchChange = (value: string) => {
    setBranchDraft(value);
    if (validateCallerMatchBranch(value, rules, index) === null && value !== rule.branch) {
      onChange(index, { ...rule, branch: value }, { from: rule.branch, to: value });
    }
  };

  return (
    <div className={styles.ruleCard}>
      <div className={styles.ruleHeader}>
        <span className={styles.ruleNumber}>rule {index + 1}</span>
        <div className={styles.ruleActions}>
          <button className={styles.iconButton} disabled={index === 0} onClick={() => onMove(index, -1)} type="button" aria-label={`move rule ${index + 1} up`}>↑</button>
          <button className={styles.iconButton} disabled={index === rules.length - 1} onClick={() => onMove(index, 1)} type="button" aria-label={`move rule ${index + 1} down`}>↓</button>
          <button className={styles.iconButton} disabled={rules.length <= 1} onClick={() => onRemove(index)} type="button" aria-label={`remove rule ${index + 1}`}>×</button>
        </div>
      </div>
      <label className={styles.field}>
        <span className={styles.fieldLabel}>branch key</span>
        <input
          className={styles.input}
          value={branchDraft}
          onChange={(event) => handleBranchChange(event.target.value)}
          aria-label={`branch key of rule ${index + 1}`}
        />
        {branchError ? <span className={styles.inlineError}>{branchError}</span> : null}
      </label>
      <label className={styles.field}>
        <span className={styles.fieldLabel}>label</span>
        <input
          className={styles.input}
          placeholder="shown on the canvas"
          value={rule.label}
          onChange={(event) => onChange(index, { ...rule, label: event.target.value })}
          aria-label={`label of rule ${index + 1}`}
        />
      </label>
      <label className={styles.field}>
        <span className={styles.fieldLabel}>match</span>
        <select
          className={styles.select}
          value={rule.match}
          onChange={(event) => {
            const match = event.target.value as CallerMatchType;
            onChange(index, { ...rule, match, value: match === 'anonymous' ? '' : rule.value });
          }}
          aria-label={`match type of rule ${index + 1}`}
        >
          {CALLER_MATCH_TYPES.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      </label>
      {rule.match !== 'anonymous' ? (
        <label className={styles.field}>
          <span className={styles.fieldLabel}>{rule.match === 'prefix' ? 'prefixes' : 'numbers'}</span>
          <textarea
            className={styles.textarea}
            placeholder={rule.match === 'prefix' ? '+3120' : '+31612345678'}
            rows={3}
            value={rule.value}
            onChange={(event) => onChange(index, { ...rule, value: event.target.value })}
            aria-label={`numbers of rule ${index + 1}`}
          />
          <span className={styles.meta}>One per line or separated by commas.</span>
          {valueError ? <span className={styles.inlineError}>{valueError}</span> : null}
        </label>
      ) : (
        <span className={styles.meta}>Matches a withheld, unknown or non-numeric caller id.</span>
      )}
    </div>
  );
}

export function CallerMatchConfigPanel({ nodeId, config, saveAttempted = false, onRulesChange }: CallerMatchConfigPanelProps) {
  const rules = readCallerMatchRules(config);

  const updateRule = (index: number, next: CallerMatchRule, rename?: CallerMatchRename) => {
    onRulesChange(rules.map((rule, ruleIndex) => (ruleIndex === index ? next : rule)), rename);
  };

  const moveRule = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= rules.length) return;
    const next = [...rules];
    [next[index], next[target]] = [next[target], next[index]];
    onRulesChange(next);
  };

  const removeRule = (index: number) => {
    if (rules.length <= 1) return;
    onRulesChange(rules.filter((_, ruleIndex) => ruleIndex !== index));
  };

  return (
    <div className={styles.form}>
      <span className={styles.meta}>Rules are checked from top to bottom. The first match decides the branch. No match uses default.</span>
      {rules.map((rule, index) => (
        <RuleRow
          key={`${nodeId}-rule-${index}`}
          rule={rule}
          index={index}
          rules={rules}
          showValueErrors={saveAttempted}
          onChange={updateRule}
          onMove={moveRule}
          onRemove={removeRule}
        />
      ))}
      <button className={styles.addButton} onClick={() => onRulesChange([...rules, createCallerMatchRule(rules)])} type="button">add rule</button>
    </div>
  );
}
