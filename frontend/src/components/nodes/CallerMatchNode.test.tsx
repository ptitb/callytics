import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CallerMatchNode } from './CallerMatchNode';
import '../../test/mocks/reactflow';

function createProps(config: Record<string, unknown>) {
  return {
    id: 'cm-1',
    data: { label: 'Who calls', type: 'caller_match', config },
    selected: false,
  } as any;
}

describe('CallerMatchNode', () => {
  it('renders a row per rule with the rule label, plus the default row', () => {
    render(
      <CallerMatchNode
        {...createProps({
          rules: [
            { branch: 'vip', label: 'VIP customer', match: 'exact', value: '+31612345678' },
            { branch: 'withheld', label: '', match: 'anonymous', value: '' },
          ],
        })}
      />,
    );

    expect(screen.getByText('caller_match')).toBeInTheDocument();
    expect(screen.getByText('Who calls')).toBeInTheDocument();
    expect(screen.getByText('VIP customer')).toBeInTheDocument();
    // A rule without a label falls back to its branch key.
    expect(screen.getByText('withheld')).toBeInTheDocument();
    expect(screen.getByText('default')).toBeInTheDocument();
  });

  it('renders only the default row without rules', () => {
    render(<CallerMatchNode {...createProps({})} />);

    expect(screen.getByText('default')).toBeInTheDocument();
  });
});
