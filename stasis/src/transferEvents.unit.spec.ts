jest.mock('./db', () => ({ query: jest.fn().mockResolvedValue([]) }));
jest.mock('./telemetry', () => ({ publishNodeTelemetry: jest.fn().mockResolvedValue(undefined) }));

import { CallSession } from './callSession';
import { query } from './db';
import { publishNodeTelemetry } from './telemetry';
import {
  buildTransferOperatorLabel,
  describePhoneTransfer,
  parseAttendedTransfer,
  parseBlindTransfer,
  PHONE_TRANSFER_NODE_TYPE,
  recordPhoneTransfer,
} from './transferEvents';

const queryMock = query as jest.MockedFunction<typeof query>;
const publishNodeTelemetryMock = publishNodeTelemetry as jest.MockedFunction<typeof publishNodeTelemetry>;

function createSession(): CallSession {
  const startedAt = new Date();
  return {
    callUuid: 'call-1',
    channelId: 'caller-1',
    callerNumber: '+31612345678',
    currentNodeKey: 'hunt-1',
    variables: {},
    webhookPayload: {},
    call_started_at: startedAt.toISOString(),
    call_ended_at: null,
    startedAt,
    recording: {
      name: 'rec',
      fileName: 'rec.wav',
      filePath: '/rec.wav',
      format: 'wav',
      startedAt,
      endedAt: null,
      operatorLabel: '101',
    },
    inboundBridge: { id: 'bridge-1' },
    flow: { id: 7, name: 'Flow', versionId: 1, nodes: [], edges: [] },
  };
}

const attendedEvent = {
  result: 'Success',
  transferee: { id: 'caller-1', name: 'PJSIP/trunk-main-00000001' },
  transferer_first_leg: { id: 'leg-101-a', name: 'PJSIP/101-00000002' },
  transferer_second_leg: { id: 'leg-101-b', name: 'PJSIP/101-00000003' },
  transfer_target: { id: 'leg-201', name: 'PJSIP/201-00000004' },
};

describe('phone transfer events', () => {
  beforeEach(() => jest.clearAllMocks());

  it('derives extensions of an attended transfer from the channel names', () => {
    const transfer = parseAttendedTransfer(attendedEvent);

    expect(transfer).toEqual({
      kind: 'attended',
      from: '101',
      to: '201',
      channelIds: ['caller-1', 'leg-101-a'],
    });
    expect(describePhoneTransfer(transfer!)).toBe('Attended transfer 101 -> 201');
  });

  it('uses exten as the target of a blind transfer', () => {
    const transfer = parseBlindTransfer({
      result: 'Success',
      channel: { id: 'leg-101-a', name: 'PJSIP/101-00000002' },
      transferee: { id: 'caller-1' },
      exten: '201',
    });

    expect(transfer).toEqual({ kind: 'blind', from: '101', to: '201', channelIds: ['caller-1', 'leg-101-a'] });
    expect(describePhoneTransfer(transfer!)).toBe('Blind transfer 101 -> 201');
  });

  it('falls back to the caller id number when the channel name has no extension', () => {
    const transfer = parseBlindTransfer({
      result: 'Success',
      channel: { id: 'x', name: 'Local/abc@ctx-0001;1', caller: { number: '105' } },
      exten: '201',
    });

    expect(transfer?.from).toBe('105');
  });

  it('ignores transfers that did not succeed', () => {
    expect(parseAttendedTransfer({ ...attendedEvent, result: 'Fail' })).toBeNull();
    expect(parseBlindTransfer({ result: 'Not Permitted', exten: '201' })).toBeNull();
  });

  it('describes a transfer with missing parties without inventing extensions', () => {
    expect(describePhoneTransfer({ kind: 'attended', from: '101', to: null, channelIds: [] })).toBe('Attended transfer 101');
    expect(describePhoneTransfer({ kind: 'blind', from: null, to: '201', channelIds: [] })).toBe('Blind transfer to 201');
  });

  it('appends the target to the operator label', () => {
    const transfer = { kind: 'blind' as const, from: '101', to: '201', channelIds: [] };

    expect(buildTransferOperatorLabel('101', transfer)).toBe('101 -> 201');
    expect(buildTransferOperatorLabel(null, transfer)).toBe('101 -> 201');
    expect(buildTransferOperatorLabel('101 -> 201', { ...transfer, from: '201', to: '305' })).toBe('101 -> 201 -> 305');
    expect(buildTransferOperatorLabel('101', { ...transfer, to: null })).toBe('101');
  });

  it('writes a timeline entry and updates the recording label', async () => {
    const session = createSession();

    await recordPhoneTransfer(session, parseAttendedTransfer(attendedEvent)!);

    expect(queryMock).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO call_node_logs'),
      ['call-1', 7, 'Attended transfer 101 -> 201', PHONE_TRANSFER_NODE_TYPE, 'attended'],
    );
    expect(publishNodeTelemetryMock).toHaveBeenCalledWith(
      session,
      expect.objectContaining({ nodeKey: 'Attended transfer 101 -> 201', type: PHONE_TRANSFER_NODE_TYPE }),
      'completed',
      { kind: 'attended', from: '101', to: '201' },
    );
    expect(session.recording?.operatorLabel).toBe('101 -> 201');
  });

  it('still publishes the live timeline event when the database insert fails', async () => {
    queryMock.mockRejectedValueOnce(new Error('db down'));

    await recordPhoneTransfer(createSession(), parseAttendedTransfer(attendedEvent)!);

    expect(publishNodeTelemetryMock).toHaveBeenCalledTimes(1);
  });
});
