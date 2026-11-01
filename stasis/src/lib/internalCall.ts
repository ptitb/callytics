/** Extension numbers that may be dialed internally: letters, digits and a few separators. */
const INTERNAL_TARGET_PATTERN = /^[A-Za-z0-9_.+-]+$/;

export type InternalCallHangupReason = 'congestion' | 'no_answer' | 'busy';

/**
 * Reads the dialed extension from the StasisStart args of an internal call
 * (Stasis(callytics,internal,<extension>) gives ["internal", "<extension>"]).
 * Returns null when the call is not an internal call or the target is invalid.
 */
export function parseInternalCallArgs(args: string[] | undefined): string | null {
  if (args?.[0] !== 'internal') {
    return null;
  }
  const target = String(args[1] ?? '').trim();
  return INTERNAL_TARGET_PATTERN.test(target) ? target : null;
}

/** Picks the ARI hangup reason for the caller from how the callee leg failed. */
export function resolveInternalHangupReason(
  reason: string,
  detail?: string,
): InternalCallHangupReason {
  if (reason === 'timeout') {
    return 'no_answer';
  }
  // Asterisk cause 17 is "User busy".
  if (detail && /busy|cause 17\b/i.test(detail)) {
    return 'busy';
  }
  return 'congestion';
}

/** Endpoint states ARI reports for a PJSIP endpoint without a registered contact. */
export function isEndpointUnavailable(state: string | undefined): boolean {
  return state === 'offline';
}
