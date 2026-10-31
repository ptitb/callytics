import { HttpError } from './errors';

export interface WebhookInput {
  callerNumber: string;
  /** When the call started, falling back to the webhook timestamp. */
  occurredAt: Date;
  /** ISO string used for dedupe, exactly as sent by Callytics. */
  occurredAtRaw: string;
  nodeId: string;
  flowId: string;
  recording?: { url: string; durationSeconds: number };
}

const MAX_TEXT_LENGTH = 128;

function cleanText(value: unknown, field: string, maxLength = MAX_TEXT_LENGTH): string {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw new HttpError(400, `${field} must be a string`);
  }
  // Control characters are removed so a value can never break a mail header or a log line.
  // eslint-disable-next-line no-control-regex
  const cleaned = String(value).replace(/[\u0000-\u001f\u007f]/g, '').trim();
  if (cleaned.length > maxLength) {
    throw new HttpError(400, `${field} is too long`);
  }
  return cleaned;
}

function parseDate(value: unknown): Date | null {
  if (typeof value !== 'string') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Validates the Callytics webhook body (see stasis/src/webhookPayload.ts) and keeps only
 * the fields the notifier needs. Throws HttpError(400) for anything unusable.
 */
export function parseWebhookBody(body: unknown, options: { requireRecording: boolean }): WebhookInput {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new HttpError(400, 'Body must be a JSON object');
  }
  const data = body as Record<string, unknown>;

  const callerNumber = cleanText(data.caller_number, 'caller_number', 64);

  const startedAt = parseDate(data.call_started_at);
  const timestamp = parseDate(data.timestamp);
  const occurredAt = startedAt ?? timestamp;
  if (!occurredAt) {
    throw new HttpError(400, 'call_started_at or timestamp must be an ISO date string');
  }
  const occurredAtRaw = startedAt ? String(data.call_started_at) : String(data.timestamp);

  const input: WebhookInput = {
    callerNumber,
    occurredAt,
    occurredAtRaw,
    nodeId: cleanText(data.node_id, 'node_id'),
    flowId: cleanText(data.flow_id, 'flow_id'),
  };

  const recording = data.recording;
  if (recording !== undefined && recording !== null) {
    if (typeof recording !== 'object' || Array.isArray(recording)) {
      throw new HttpError(400, 'recording must be an object');
    }
    const { url, duration_seconds: duration } = recording as Record<string, unknown>;
    if (typeof url !== 'string' || url.length === 0 || url.length > 512) {
      throw new HttpError(400, 'recording.url must be a string');
    }
    const durationSeconds = duration === undefined ? 0 : Number(duration);
    if (!Number.isFinite(durationSeconds) || durationSeconds < 0) {
      throw new HttpError(400, 'recording.duration_seconds must be a non-negative number');
    }
    input.recording = { url, durationSeconds: Math.round(durationSeconds) };
  } else if (options.requireRecording) {
    throw new HttpError(400, 'recording.url is required for a voicemail notification');
  }

  return input;
}
