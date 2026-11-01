import {
  isEndpointUnavailable,
  parseInternalCallArgs,
  resolveInternalHangupReason,
} from './internalCall';

describe('parseInternalCallArgs', () => {
  it('returns the dialed extension', () => {
    expect(parseInternalCallArgs(['internal', '201'])).toBe('201');
    expect(parseInternalCallArgs(['internal', ' alice.b '])).toBe('alice.b');
  });

  it('returns null for other calls', () => {
    expect(parseInternalCallArgs(undefined)).toBeNull();
    expect(parseInternalCallArgs([])).toBeNull();
    expect(parseInternalCallArgs(['direct-outbound', '201'])).toBeNull();
  });

  it('returns null for a missing or invalid target', () => {
    expect(parseInternalCallArgs(['internal'])).toBeNull();
    expect(parseInternalCallArgs(['internal', ''])).toBeNull();
    expect(parseInternalCallArgs(['internal', '2 01'])).toBeNull();
    expect(parseInternalCallArgs(['internal', '201@trunk-1'])).toBeNull();
  });
});

describe('resolveInternalHangupReason', () => {
  it('maps a timeout to no answer', () => {
    expect(resolveInternalHangupReason('timeout')).toBe('no_answer');
  });

  it('maps a busy callee to busy', () => {
    expect(resolveInternalHangupReason('destroyed', 'User busy (cause 17)')).toBe('busy');
    expect(resolveInternalHangupReason('destroyed', 'Something (cause 17)')).toBe('busy');
  });

  it('maps everything else to congestion', () => {
    expect(resolveInternalHangupReason('destroyed', 'Unallocated (cause 1)')).toBe('congestion');
    expect(resolveInternalHangupReason('failed', 'originate failed: no contact')).toBe('congestion');
    expect(resolveInternalHangupReason('caller_disconnected')).toBe('congestion');
  });
});

describe('isEndpointUnavailable', () => {
  it('only treats offline as unavailable', () => {
    expect(isEndpointUnavailable('offline')).toBe(true);
    expect(isEndpointUnavailable('online')).toBe(false);
    expect(isEndpointUnavailable('unknown')).toBe(false);
    expect(isEndpointUnavailable(undefined)).toBe(false);
  });
});
