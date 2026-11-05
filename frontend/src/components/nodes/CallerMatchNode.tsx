import { Handle, NodeProps, Position } from 'reactflow';
import type { FlowNodeData } from '../../types';
import { callerMatchBranchLabel, readCallerMatchRules } from '../../lib/callerMatch';
import styles from './CallerMatchNode.module.css';

export function CallerMatchNode({ data, selected }: NodeProps<FlowNodeData & { diffColor?: string }>) {
  const rules = readCallerMatchRules(data.config);
  const diffStyle = data.diffColor ? { borderColor: `var(${data.diffColor})`, boxShadow: `0 0 0 2px color-mix(in srgb, var(${data.diffColor}) 20%, transparent)` } : undefined;

  return (
    <div
      className={`${styles.node} ${selected ? styles.selected : ''} ${data.hasValidationError ? styles.invalid : ''}`}
      style={diffStyle}
    >
      {data.hasValidationError ? <span className={styles.validationDot} title={data.validationIssues?.join(', ')} /> : null}
      <span className={styles.accent} />
      <Handle className={styles.handle} type="target" position={Position.Left} isConnectableStart={false} />
      <div className={styles.body}>
        <div className={styles.header}>
          <span className={styles.icon} aria-hidden="true">
            <svg viewBox="0 0 16 16" focusable="false">
              <path d="M3 3.5h3l1 3-1.5 1a7 7 0 0 0 3 3l1-1.5 3 1v3a1.5 1.5 0 0 1-1.5 1.5A10 10 0 0 1 1.5 5 1.5 1.5 0 0 1 3 3.5Z" />
            </svg>
          </span>
          <div>
            <div className={styles.type}>caller_match</div>
            <div className={styles.label}>{data.label}</div>
          </div>
        </div>

        <div className={styles.branchList}>
          {rules.map((rule) => (
            <div className={styles.branchRow} key={rule.branch}>
              <span className={`${styles.branchLabel} ${styles.branchText}`} title={rule.branch}>{callerMatchBranchLabel(rule)}</span>
              <Handle className={styles.branchHandle} id={rule.branch} type="source" position={Position.Right} isConnectableEnd={false} />
            </div>
          ))}
          <div className={styles.branchRow}>
            <span className={`${styles.branchLabel} ${styles.defaultLabel}`}>default</span>
            <Handle className={styles.branchHandle} id="default" type="source" position={Position.Right} isConnectableEnd={false} />
          </div>
        </div>
      </div>
      {selected && data.onDelete ? (
        <button
          className={styles.deleteButton}
          onClick={(event) => {
            event.stopPropagation();
            data.onDelete?.();
          }}
          type="button"
        >
          ×
        </button>
      ) : null}
    </div>
  );
}
