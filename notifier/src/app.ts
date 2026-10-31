import { IncomingMessage, RequestListener, ServerResponse } from 'http';
import { tokenMatches } from './auth';
import { NotifierConfig } from './config';
import { dedupeKey, OncePerWindow } from './dedupe';
import { HttpError } from './errors';
import { Logger } from './logger';
import { Mailer, MailAttachment } from './mailer';
import { parseWebhookBody, WebhookInput } from './payload';
import { toFileNamePart } from './phone';
import { assertBackendRecordingUrl } from './recordingUrl';
import { buildMissedCallMail, buildVoicemailMail } from './templates';
import { formatFileStamp } from './time';

export const MAX_BODY_BYTES = 64 * 1024;
export const DEDUPE_WINDOW_MS = 10 * 60 * 1000;

export interface AppDeps {
  config: NotifierConfig;
  mailer: Mailer;
  logger: Logger;
  /** Fetches the WAV for an already validated backend URL. */
  downloadRecording: (url: URL) => Promise<Buffer>;
  convertToMp3: (wav: Buffer) => Promise<Buffer>;
  deduper?: OncePerWindow;
}

type WebhookKind = 'missed-call' | 'voicemail';

const ROUTES: Record<string, WebhookKind> = {
  '/webhooks/missed-call': 'missed-call',
  '/webhooks/voicemail': 'voicemail',
};

function sendJson(res: ServerResponse, status: number, body: Record<string, unknown>): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new HttpError(413, 'Request body is too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    throw new HttpError(400, 'Body is not valid JSON');
  }
}

export function createApp(deps: AppDeps): RequestListener {
  const { config, logger } = deps;
  const deduper = deps.deduper ?? new OncePerWindow(DEDUPE_WINDOW_MS);

  async function sendMissedCall(input: WebhookInput): Promise<void> {
    const mail = buildMissedCallMail(config.language, {
      callerNumber: input.callerNumber,
      occurredAt: input.occurredAt,
      timezone: config.timezone,
      nodeId: input.nodeId,
      flowId: input.flowId,
    });
    await sendMail(mail.subject, () => deps.mailer.send(mail));
    logger.info(`missed call mail sent caller=${input.callerNumber || 'unknown'} node=${input.nodeId}`);
  }

  async function sendVoicemail(input: WebhookInput): Promise<void> {
    const recording = input.recording as NonNullable<WebhookInput['recording']>;
    const url = assertBackendRecordingUrl(recording.url, config.backendUrl);
    const wav = await deps.downloadRecording(url);

    const baseName = `voicemail-${formatFileStamp(input.occurredAt, config.timezone)}-${toFileNamePart(input.callerNumber)}`;
    let attachment: MailAttachment;
    let converted = true;
    try {
      attachment = {
        filename: `${baseName}.mp3`,
        content: await deps.convertToMp3(wav),
        contentType: 'audio/mpeg',
      };
    } catch (error) {
      converted = false;
      logger.warn(`mp3 conversion failed, attaching the original wav: ${(error as Error).message}`);
      attachment = { filename: `${baseName}.wav`, content: wav, contentType: 'audio/wav' };
    }

    const mail = buildVoicemailMail(config.language, {
      callerNumber: input.callerNumber,
      occurredAt: input.occurredAt,
      timezone: config.timezone,
      nodeId: input.nodeId,
      flowId: input.flowId,
      durationSeconds: recording.durationSeconds,
      attachmentName: attachment.filename,
      converted,
    });
    await sendMail(mail.subject, () => deps.mailer.send({ ...mail, attachments: [attachment] }));
    logger.info(
      `voicemail mail sent caller=${input.callerNumber || 'unknown'} attachment=${attachment.filename} bytes=${attachment.content.length}`,
    );
  }

  async function sendMail(subject: string, send: () => Promise<void>): Promise<void> {
    try {
      await send();
    } catch (error) {
      logger.error(`SMTP send failed for "${subject}": ${(error as Error).message}`);
      throw new HttpError(502, 'The mail server did not accept the message');
    }
  }

  async function handleWebhook(kind: WebhookKind, req: IncomingMessage, res: ServerResponse): Promise<void> {
    // Authentication comes first. Without a configured token every request ends in the 503 below.
    if (config.token && !tokenMatches(req.headers['x-callytics-token'] as string | undefined, config.token)) {
      throw new HttpError(401, 'Invalid or missing X-Callytics-Token');
    }
    if (config.problems.length > 0) {
      throw new HttpError(503, `Notifier is not configured: ${config.problems.join('; ')}`);
    }

    const input = parseWebhookBody(parseJson(await readBody(req)), { requireRecording: kind === 'voicemail' });
    if (input.recording) {
      // Fail fast with 400 before any work is queued.
      assertBackendRecordingUrl(input.recording.url, config.backendUrl);
    }

    const key = dedupeKey(kind, input.callerNumber, input.occurredAtRaw, input.nodeId, input.recording?.url);
    const outcome = await deduper.run(key, () => (kind === 'voicemail' ? sendVoicemail(input) : sendMissedCall(input)));

    sendJson(res, 200, { status: outcome.duplicate ? 'duplicate' : 'sent' });
  }

  return async (req, res) => {
    try {
      const path = (req.url ?? '').split('?')[0];

      if (path === '/health') {
        if (req.method !== 'GET') throw new HttpError(405, 'Method not allowed');
        sendJson(res, 200, { status: 'ok', ready: config.problems.length === 0 });
        return;
      }

      const kind = ROUTES[path];
      if (!kind) throw new HttpError(404, 'Not found');
      if (req.method !== 'POST') throw new HttpError(405, 'Method not allowed');

      await handleWebhook(kind, req, res);
    } catch (error) {
      if (error instanceof HttpError) {
        sendJson(res, error.status, { error: error.message });
        return;
      }
      logger.error(`unexpected error: ${(error as Error).stack ?? error}`);
      sendJson(res, 500, { error: 'Internal error' });
    }
  };
}
