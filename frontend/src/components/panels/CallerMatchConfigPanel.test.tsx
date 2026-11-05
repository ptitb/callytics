import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { CallerMatchConfigPanel } from './CallerMatchConfigPanel';

const rules = [
  { branch: 'vip', label: 'VIP customer', match: 'exact', value: '+31612345678' },
  { branch: 'withheld', label: '', match: 'anonymous', value: '' },
];

function renderPanel(overrides: { config?: Record<string, unknown>; saveAttempted?: boolean } = {}) {
  const onRulesChange = vi.fn();
  render(
    <CallerMatchConfigPanel
      nodeId="cm-1"
      config={overrides.config ?? { rules }}
      saveAttempted={overrides.saveAttempted}
      onRulesChange={onRulesChange}
    />,
  );
  return onRulesChange;
}

describe('CallerMatchConfigPanel', () => {
  it('renders a card per rule and hides the numbers for the anonymous match', () => {
    renderPanel();

    expect(screen.getByText('rule 1')).toBeInTheDocument();
    expect(screen.getByText('rule 2')).toBeInTheDocument();
    expect(screen.getByLabelText('numbers of rule 1')).toHaveValue('+31612345678');
    expect(screen.queryByLabelText('numbers of rule 2')).not.toBeInTheDocument();
  });

  it('adds a rule with a generated branch key', () => {
    const onRulesChange = renderPanel();

    fireEvent.click(screen.getByRole('button', { name: 'add rule' }));

    const next = onRulesChange.mock.calls[0][0];
    expect(next).toHaveLength(3);
    expect(next[2]).toEqual({ branch: 'rule_3', label: '', match: 'exact', value: '' });
  });

  it('removes a rule but keeps the last one', () => {
    const onRulesChange = renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'remove rule 1' }));
    expect(onRulesChange.mock.calls[0][0].map((rule: { branch: string }) => rule.branch)).toEqual(['withheld']);

    renderPanel({ config: { rules: [rules[0]] } });
    expect(screen.getAllByRole('button', { name: 'remove rule 1' }).at(-1)).toBeDisabled();
  });

  it('reorders rules and disables the outer moves', () => {
    const onRulesChange = renderPanel();

    expect(screen.getByRole('button', { name: 'move rule 1 up' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'move rule 2 down' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'move rule 1 down' }));

    expect(onRulesChange.mock.calls[0][0].map((rule: { branch: string }) => rule.branch)).toEqual(['withheld', 'vip']);
  });

  it('reports a branch rename so the edge can follow', () => {
    const onRulesChange = renderPanel();

    fireEvent.change(screen.getByLabelText('branch key of rule 1'), { target: { value: 'gold' } });

    expect(onRulesChange).toHaveBeenCalledWith(
      [{ ...rules[0], branch: 'gold' }, rules[1]],
      { from: 'vip', to: 'gold' },
    );
  });

  it('does not commit an invalid branch key and shows the reason', () => {
    const onRulesChange = renderPanel();

    fireEvent.change(screen.getByLabelText('branch key of rule 1'), { target: { value: 'default' } });

    expect(onRulesChange).not.toHaveBeenCalled();
    expect(screen.getByText('default is reserved')).toBeInTheDocument();
  });

  it('does not commit a branch key that another rule uses', () => {
    const onRulesChange = renderPanel();

    fireEvent.change(screen.getByLabelText('branch key of rule 1'), { target: { value: 'withheld' } });

    expect(onRulesChange).not.toHaveBeenCalled();
    expect(screen.getByText('Branch key must be unique')).toBeInTheDocument();
  });

  it('clears the numbers when the match type changes to anonymous', () => {
    const onRulesChange = renderPanel();

    fireEvent.change(screen.getByLabelText('match type of rule 1'), { target: { value: 'anonymous' } });

    expect(onRulesChange.mock.calls[0][0][0]).toEqual({ ...rules[0], match: 'anonymous', value: '' });
  });

  it('shows the value error only after a save attempt', () => {
    const emptyRule = { branch: 'a', label: '', match: 'prefix', value: '' };
    renderPanel({ config: { rules: [emptyRule] } });
    expect(screen.queryByText('At least one number is required')).not.toBeInTheDocument();

    renderPanel({ config: { rules: [emptyRule] }, saveAttempted: true });
    expect(screen.getByText('At least one number is required')).toBeInTheDocument();
  });
});
