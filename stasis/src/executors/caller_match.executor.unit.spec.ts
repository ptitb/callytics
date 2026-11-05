import { executeCallerMatch } from './caller_match.executor';
import { DEFAULT_OUTBOUND_NUMBER_SETTINGS } from '../lib/outboundNumber';
import type { CallSession } from '../callSession';
import type { FlowNode } from '../flowLoader';

const node: FlowNode = {
  nodeKey: 'caller-match-1',
  type: 'caller_match',
  label: 'Caller match',
  config: {
    rules: [
      { branch: 'vip', match: 'exact', value: '+31612345678' },
      { branch: 'anonymous', match: 'anonymous' },
    ],
  },
};

function sessionFor(callerNumber: string): CallSession {
  return { channelId: 'channel-1', callerNumber } as CallSession;
}

const loadSettings = async () => DEFAULT_OUTBOUND_NUMBER_SETTINGS;

describe('caller_match.executor', () => {
  it('returns the branch of the matching rule', async () => {
    await expect(executeCallerMatch(node, sessionFor('0612345678'), loadSettings)).resolves.toBe('vip');
  });

  it('returns the anonymous branch for the unknown caller id Asterisk delivers', async () => {
    await expect(executeCallerMatch(node, sessionFor('unknown'), loadSettings)).resolves.toBe('anonymous');
  });

  it('returns default when no rule matches', async () => {
    await expect(executeCallerMatch(node, sessionFor('+4915112345678'), loadSettings)).resolves.toBe('default');
  });
});
