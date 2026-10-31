import { beginNodeRecording, persistSessionRecording } from './bridgeRecording';
import type { CallSession } from './callSession';

jest.mock('./logger', () => ({ logEvent: jest.fn() }));

function createSession(): CallSession {
  return {
    callUuid: 'call-1',
    channelId: 'ch-1',
    callerNumber: '+31612345678',
    flow: { id: 7 },
    recording: null,
  } as unknown as CallSession;
}

describe('bridgeRecording', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.clearAllMocks();
  });

  it('keeps the operator label on the recording state when a node recording starts', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true }) as unknown as typeof fetch;
    const session = createSession();

    await beginNodeRecording(session, 'bridge-1', 'call-1-hunt-1', 'hunt', '101');

    expect(session.recording?.operatorLabel).toBe('101');
  });

  it('sends remote number and operator label when persisting the recording', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { id: 12 } }),
    }) as unknown as typeof fetch;
    const session = createSession();
    session.recording = {
      name: 'call-1-hunt-1',
      fileName: 'call-1-hunt-1.wav',
      filePath: '/var/lib/asterisk/recording/call-1-hunt-1.wav',
      format: 'wav',
      startedAt: new Date('2026-01-01T10:00:00Z'),
      endedAt: new Date('2026-01-01T10:01:00Z'),
      operatorLabel: '101',
    };

    const result = await persistSessionRecording(session);

    expect(result?.id).toBe(12);
    const body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
    expect(body).toEqual(expect.objectContaining({
      callId: 'call-1',
      flowId: 7,
      remoteNumber: '+31612345678',
      operatorLabel: '101',
    }));
  });

  it('sends null operator label when none was set', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { id: 13 } }),
    }) as unknown as typeof fetch;
    const session = createSession();
    session.recording = {
      name: 'n',
      fileName: 'n.wav',
      filePath: '/var/lib/asterisk/recording/n.wav',
      format: 'wav',
      startedAt: new Date('2026-01-01T10:00:00Z'),
      endedAt: new Date('2026-01-01T10:00:30Z'),
    };

    await persistSessionRecording(session);

    const body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
    expect(body.operatorLabel).toBeNull();
  });
});
