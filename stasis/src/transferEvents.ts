import { CallSession } from './callSession';
import { query } from './db';
import { logEvent } from './logger';
import { publishNodeTelemetry } from './telemetry';

/** Node type of the call timeline entry written for a transfer done by a phone. */
export const PHONE_TRANSFER_NODE_TYPE = 'phone_transfer';

interface AriChannelInfo {
  id?: string;
  name?: string;
  caller?: { number?: string };
  connected?: { number?: string };
}

/** Fields of the ARI BridgeAttendedTransfer event that are used here. */
export interface BridgeAttendedTransferEvent {
  transferer_first_leg?: AriChannelInfo;
  transferer_second_leg?: AriChannelInfo;
  transferee?: AriChannelInfo;
  transfer_target?: AriChannelInfo;
  result?: string;
}

/** Fields of the ARI BridgeBlindTransfer event that are used here. */
export interface BridgeBlindTransferEvent {
  channel?: AriChannelInfo;
  transferee?: AriChannelInfo;
  exten?: string;
  result?: string;
}

export interface PhoneTransfer {
  kind: 'attended' | 'blind';
  /** Extension that transferred the call. */
  from: string | null;
  /** Extension or number the call was transferred to. */
  to: string | null;
  /** Channels that can identify the call the transfer belongs to. */
  channelIds: string[];
}

// PJSIP channel names look like PJSIP/101-00000012.
const PJSIP_CHANNEL_NAME = /^PJSIP\/(.+)-[0-9a-f]{8}$/i;

/** Reads the extension of a channel from its name, falling back to the caller id number. */
function extensionOf(channel: AriChannelInfo | undefined): string | null {
  if (!channel) {
    return null;
  }
  const fromName = channel.name ? PJSIP_CHANNEL_NAME.exec(channel.name)?.[1] : undefined;
  const number = fromName || channel.caller?.number || channel.connected?.number || '';
  return number.trim() || null;
}

function idsOf(...channels: Array<AriChannelInfo | undefined>): string[] {
  return channels.flatMap((channel) => (channel?.id ? [channel.id] : []));
}

/** Returns null unless the transfer succeeded. */
export function parseAttendedTransfer(event: BridgeAttendedTransferEvent): PhoneTransfer | null {
  if (event.result !== 'Success') {
    return null;
  }
  return {
    kind: 'attended',
    from: extensionOf(event.transferer_first_leg),
    to: extensionOf(event.transfer_target),
    channelIds: idsOf(event.transferee, event.transferer_first_leg),
  };
}

/** Returns null unless the transfer succeeded. */
export function parseBlindTransfer(event: BridgeBlindTransferEvent): PhoneTransfer | null {
  if (event.result !== 'Success') {
    return null;
  }
  return {
    kind: 'blind',
    from: extensionOf(event.channel),
    to: event.exten?.trim() || null,
    channelIds: idsOf(event.transferee, event.channel),
  };
}

/** Text of the timeline entry, e.g. "Attended transfer 101 -> 201". */
export function describePhoneTransfer(transfer: PhoneTransfer): string {
  const label = transfer.kind === 'attended' ? 'Attended transfer' : 'Blind transfer';
  if (transfer.from && transfer.to) {
    return `${label} ${transfer.from} -> ${transfer.to}`;
  }
  if (transfer.to) {
    return `${label} to ${transfer.to}`;
  }
  return transfer.from ? `${label} ${transfer.from}` : label;
}

/** Appends the transfer target to the recording's operator label, e.g. "101" becomes "101 -> 201". */
export function buildTransferOperatorLabel(
  currentLabel: string | null | undefined,
  transfer: PhoneTransfer,
): string | null {
  if (!transfer.to) {
    return currentLabel ?? null;
  }
  const start = currentLabel || transfer.from;
  return start ? `${start} -> ${transfer.to}` : transfer.to;
}

/** Adds the transfer to the call's timeline and to the label of the recording in progress. */
export async function recordPhoneTransfer(session: CallSession, transfer: PhoneTransfer): Promise<void> {
  const description = describePhoneTransfer(transfer);
  logEvent('PhoneTransfer', {
    callId: session.callUuid,
    kind: transfer.kind,
    from: transfer.from,
    to: transfer.to,
  });

  if (session.recording && !session.recording.endedAt) {
    session.recording.operatorLabel = buildTransferOperatorLabel(session.recording.operatorLabel, transfer);
  }

  try {
    await query(
      `
        INSERT INTO call_node_logs (call_uuid, flow_id, node_key, node_type, entered_at, exited_at, exit_branch)
        VALUES ($1, $2, $3, $4, NOW(), NOW(), $5)
      `,
      [session.callUuid, session.flow.id, description, PHONE_TRANSFER_NODE_TYPE, transfer.kind],
    );
  } catch (error) {
    logEvent('CallNodeLogInsertFailed', { callId: session.callUuid, nodeId: description, error });
  }

  await publishNodeTelemetry(
    session,
    { nodeKey: description, type: PHONE_TRANSFER_NODE_TYPE, label: description, config: {} },
    'completed',
    { kind: transfer.kind, from: transfer.from, to: transfer.to },
  );
}
