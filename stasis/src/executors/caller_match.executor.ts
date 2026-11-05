import { CallSession } from '../callSession';
import { FlowNode } from '../flowLoader';
import { logEvent } from '../logger';
import { evaluateCallerMatch, type CallerMatchConfig } from '../lib/callerMatch';
import {
  DEFAULT_OUTBOUND_NUMBER_SETTINGS,
  parseOutboundNumberSettings,
  type OutboundNumberSettings,
} from '../lib/outboundNumber';

const BACKEND_URL = process.env.BACKEND_URL || 'http://127.0.0.1:3001';

/**
 * Reads the outbound number settings (default country code, international prefix).
 * Falls back to the defaults so a settings failure never blocks the call.
 */
export async function loadNumberSettings(): Promise<OutboundNumberSettings> {
  try {
    const response = await fetch(`${BACKEND_URL}/settings`);
    if (!response.ok) {
      return DEFAULT_OUTBOUND_NUMBER_SETTINGS;
    }
    const payload = (await response.json()) as Record<string, unknown> & { data?: Record<string, unknown> };
    return parseOutboundNumberSettings(payload.data ?? payload);
  } catch {
    return DEFAULT_OUTBOUND_NUMBER_SETTINGS;
  }
}

/** Branches on the caller's number. Returns the branch key of the first matching rule, or "default". */
export async function executeCallerMatch(
  node: FlowNode,
  session: CallSession,
  loadSettings: () => Promise<OutboundNumberSettings> = loadNumberSettings,
): Promise<string> {
  const settings = await loadSettings();
  const config = (node.config || {}) as CallerMatchConfig;
  const { branch, normalizedCaller } = evaluateCallerMatch(config, session.callerNumber, settings);

  // The branch key ends up as exit_branch in the call log, so the trace shows which rule matched.
  logEvent('CallerMatchResult', {
    nodeId: node.nodeKey,
    channelId: session.channelId,
    caller: normalizedCaller ?? 'anonymous',
    branch,
  });
  return branch;
}
