import { parseWebhookBody } from './payload';

const base = {
  caller_number: '31612345678',
  flow_id: 7,
  node_type: 'play_audio',
  node_id: 'no_answer_monday',
  timestamp: '2026-11-03T09:01:30.000Z',
  call_started_at: '2026-11-03T09:01:05.000Z',
};

describe('parseWebhookBody', () => {
  it('keeps the fields the notifier needs', () => {
    const input = parseWebhookBody(base, { requireRecording: false });
    expect(input.callerNumber).toBe('31612345678');
    expect(input.nodeId).toBe('no_answer_monday');
    expect(input.flowId).toBe('7');
    expect(input.occurredAt.toISOString()).toBe('2026-11-03T09:01:05.000Z');
    expect(input.recording).toBeUndefined();
  });

  it('falls back to the webhook timestamp when the call start is missing', () => {
    const input = parseWebhookBody({ ...base, call_started_at: null }, { requireRecording: false });
    expect(input.occurredAt.toISOString()).toBe('2026-11-03T09:01:30.000Z');
  });

  it('accepts an empty caller number (anonymous caller)', () => {
    expect(parseWebhookBody({ ...base, caller_number: '' }, { requireRecording: false }).callerNumber).toBe('');
  });

  it('removes control characters from text fields', () => {
    const input = parseWebhookBody({ ...base, caller_number: '0612\r\nBcc: x@example.com' }, { requireRecording: false });
    expect(input.callerNumber).not.toMatch(/[\r\n]/);
  });

  it.each([
    ['a non-object body', 'text'],
    ['an array', []],
    ['no usable date', { ...base, call_started_at: 'nonsense', timestamp: undefined }],
    ['an object as caller number', { ...base, caller_number: { a: 1 } }],
    ['an over-long caller number', { ...base, caller_number: '1'.repeat(65) }],
  ])('rejects %s', (_label, body) => {
    expect(() => parseWebhookBody(body, { requireRecording: false })).toThrow(expect.objectContaining({ status: 400 }));
  });

  describe('recording', () => {
    const recording = { url: 'http://127.0.0.1:3001/recordings/1/download', duration_seconds: 18.4 };

    it('is parsed and the duration is rounded', () => {
      const input = parseWebhookBody({ ...base, recording }, { requireRecording: true });
      expect(input.recording).toEqual({ url: recording.url, durationSeconds: 18 });
    });

    it('is required for voicemail', () => {
      expect(() => parseWebhookBody(base, { requireRecording: true })).toThrow(expect.objectContaining({ status: 400 }));
    });

    it.each([
      [{ url: '' }],
      [{ url: 123 }],
      [{ url: recording.url, duration_seconds: -1 }],
      [{ url: recording.url, duration_seconds: 'abc' }],
    ])('rejects %j', (bad) => {
      expect(() => parseWebhookBody({ ...base, recording: bad }, { requireRecording: true })).toThrow(
        expect.objectContaining({ status: 400 }),
      );
    });
  });
});
