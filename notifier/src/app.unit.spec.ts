import { createServer, Server } from 'http';
import { AddressInfo } from 'net';
import { createApp, AppDeps, MAX_BODY_BYTES } from './app';
import { NotifierConfig } from './config';
import { Mailer, MailMessage } from './mailer';
import { testConfig } from './testUtils';

const silentLogger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };

const missedCallBody = {
  caller_number: '31612345678',
  flow_id: 7,
  node_type: 'play_audio',
  node_id: 'no_answer_monday',
  timestamp: '2026-11-03T09:01:30.000Z',
  call_started_at: '2026-11-03T09:01:05.000Z',
};

const voicemailBody = {
  ...missedCallBody,
  node_type: 'voicemail',
  node_id: 'voicemail_main',
  recording: { url: 'http://127.0.0.1:3001/recordings/42/download', duration_seconds: 18 },
};

interface Harness {
  baseUrl: string;
  sent: MailMessage[];
  deps: AppDeps;
  mailer: { send: jest.Mock };
  post: (path: string, body: unknown, headers?: Record<string, string>) => Promise<{ status: number; json: Record<string, unknown> }>;
  close: () => Promise<void>;
}

async function start(configOverrides: Partial<NotifierConfig> = {}, depsOverrides: Partial<AppDeps> = {}): Promise<Harness> {
  const sent: MailMessage[] = [];
  const mailer = { send: jest.fn(async (message: MailMessage) => { sent.push(message); }) };
  const deps: AppDeps = {
    config: testConfig(configOverrides),
    mailer: mailer as Mailer,
    logger: silentLogger,
    downloadRecording: jest.fn().mockResolvedValue(Buffer.from('wav-bytes')),
    convertToMp3: jest.fn().mockResolvedValue(Buffer.from('mp3-bytes')),
    ...depsOverrides,
  };
  const server: Server = createServer(createApp(deps));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  return {
    baseUrl,
    sent,
    deps,
    mailer,
    async post(path, body, headers = { 'X-Callytics-Token': 'secret-token' }) {
      const response = await fetch(`${baseUrl}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: typeof body === 'string' ? body : JSON.stringify(body),
      });
      return { status: response.status, json: (await response.json()) as Record<string, unknown> };
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

describe('notifier app', () => {
  let harness: Harness;

  afterEach(async () => {
    await harness.close();
    jest.clearAllMocks();
  });

  describe('GET /health', () => {
    it('answers without a token and reports readiness', async () => {
      harness = await start();
      const response = await fetch(`${harness.baseUrl}/health`);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ status: 'ok', ready: true });
    });

    it('stays healthy when SMTP is not configured', async () => {
      harness = await start({ problems: ['SMTP_HOST is not set'] });
      const response = await fetch(`${harness.baseUrl}/health`);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ status: 'ok', ready: false });
    });
  });

  describe('authentication and routing', () => {
    beforeEach(async () => { harness = await start(); });

    it.each([
      ['no token', {}],
      ['a wrong token', { 'X-Callytics-Token': 'nope' }],
    ])('answers 401 for %s and sends nothing', async (_label, headers) => {
      const result = await harness.post('/webhooks/missed-call', missedCallBody, headers);
      expect(result.status).toBe(401);
      expect(harness.mailer.send).not.toHaveBeenCalled();
    });

    it('answers 404 for unknown paths and 405 for other methods', async () => {
      expect((await harness.post('/webhooks/other', missedCallBody)).status).toBe(404);
      const get = await fetch(`${harness.baseUrl}/webhooks/missed-call`);
      expect(get.status).toBe(405);
    });
  });

  describe('POST /webhooks/missed-call', () => {
    it('sends one mail and answers 200 after SMTP accepted it', async () => {
      harness = await start();
      const result = await harness.post('/webhooks/missed-call', missedCallBody);

      expect(result).toEqual({ status: 200, json: { status: 'sent' } });
      expect(harness.sent).toHaveLength(1);
      expect(harness.sent[0].subject).toBe('Gemiste oproep van 0612345678');
      expect(harness.sent[0].attachments).toBeUndefined();
    });

    it('uses the configured language', async () => {
      harness = await start({ language: 'en' });
      await harness.post('/webhooks/missed-call', missedCallBody);
      expect(harness.sent[0].subject).toBe('Missed call from 0612345678');
    });

    it('answers 502 when SMTP fails, so Callytics retries, and mails again on the retry', async () => {
      harness = await start();
      harness.mailer.send.mockRejectedValueOnce(new Error('smtp down'));

      expect((await harness.post('/webhooks/missed-call', missedCallBody)).status).toBe(502);
      expect((await harness.post('/webhooks/missed-call', missedCallBody)).json).toEqual({ status: 'sent' });
      expect(harness.sent).toHaveLength(1);
    });

    it('does not mail a retried payload twice', async () => {
      harness = await start();
      await harness.post('/webhooks/missed-call', missedCallBody);
      const second = await harness.post('/webhooks/missed-call', missedCallBody);

      expect(second).toEqual({ status: 200, json: { status: 'duplicate' } });
      expect(harness.sent).toHaveLength(1);
    });

    it('mails a different call', async () => {
      harness = await start();
      await harness.post('/webhooks/missed-call', missedCallBody);
      await harness.post('/webhooks/missed-call', { ...missedCallBody, call_started_at: '2026-11-03T10:00:00.000Z' });
      expect(harness.sent).toHaveLength(2);
    });

    it.each([
      ['invalid JSON', '{not json'],
      ['a non-object', '"text"'],
      ['no date', { caller_number: '1' }],
    ])('answers 400 for %s', async (_label, body) => {
      harness = await start();
      const result = await harness.post('/webhooks/missed-call', body);
      expect(result.status).toBe(400);
      expect(harness.mailer.send).not.toHaveBeenCalled();
    });

    it('answers 413 for an oversized body', async () => {
      harness = await start();
      const result = await harness.post('/webhooks/missed-call', { ...missedCallBody, padding: 'x'.repeat(MAX_BODY_BYTES) }).catch(
        () => ({ status: 413 }),
      );
      expect(result.status).toBe(413);
      expect(harness.mailer.send).not.toHaveBeenCalled();
    });
  });

  describe('POST /webhooks/voicemail', () => {
    it('downloads, converts and mails the voicemail as MP3', async () => {
      harness = await start();
      const result = await harness.post('/webhooks/voicemail', voicemailBody);

      expect(result).toEqual({ status: 200, json: { status: 'sent' } });
      expect(harness.deps.downloadRecording).toHaveBeenCalledWith(new URL('http://127.0.0.1:3001/recordings/42/download'));
      expect(harness.sent[0].subject).toBe('Nieuwe voicemail van 0612345678 (18 s)');
      expect(harness.sent[0].attachments).toEqual([
        { filename: 'voicemail-2026-11-03-1001-0612345678.mp3', content: Buffer.from('mp3-bytes'), contentType: 'audio/mpeg' },
      ]);
      expect(harness.sent[0].text).not.toContain('mislukt');
    });

    it('attaches the original WAV and says so when conversion fails', async () => {
      harness = await start({}, { convertToMp3: jest.fn().mockRejectedValue(new Error('ffmpeg missing')) });
      const result = await harness.post('/webhooks/voicemail', voicemailBody);

      expect(result.status).toBe(200);
      expect(harness.sent[0].attachments).toEqual([
        { filename: 'voicemail-2026-11-03-1001-0612345678.wav', content: Buffer.from('wav-bytes'), contentType: 'audio/wav' },
      ]);
      expect(harness.sent[0].text).toContain('De omzetting naar MP3 is mislukt');
    });

    it('refuses a recording URL on another host without downloading anything', async () => {
      harness = await start();
      const result = await harness.post('/webhooks/voicemail', {
        ...voicemailBody,
        recording: { url: 'http://169.254.169.254/recordings/42/download', duration_seconds: 5 },
      });

      expect(result.status).toBe(400);
      expect(harness.deps.downloadRecording).not.toHaveBeenCalled();
      expect(harness.mailer.send).not.toHaveBeenCalled();
    });

    it('answers 400 when the recording is missing', async () => {
      harness = await start();
      expect((await harness.post('/webhooks/voicemail', missedCallBody)).status).toBe(400);
    });

    it('answers 502 when the download fails', async () => {
      const { HttpError } = await import('./errors');
      harness = await start({}, { downloadRecording: jest.fn().mockRejectedValue(new HttpError(502, 'gone')) });
      expect((await harness.post('/webhooks/voicemail', voicemailBody)).status).toBe(502);
      expect(harness.mailer.send).not.toHaveBeenCalled();
    });

    it('answers 502 when SMTP fails', async () => {
      harness = await start();
      harness.mailer.send.mockRejectedValue(new Error('smtp down'));
      expect((await harness.post('/webhooks/voicemail', voicemailBody)).status).toBe(502);
    });

    it('does not mail a retried voicemail twice', async () => {
      harness = await start();
      await harness.post('/webhooks/voicemail', voicemailBody);
      expect((await harness.post('/webhooks/voicemail', voicemailBody)).json).toEqual({ status: 'duplicate' });
      expect(harness.sent).toHaveLength(1);
    });

    it('waits for a slow first attempt instead of mailing twice', async () => {
      let release!: () => void;
      const slowDownload = jest.fn(() => new Promise<Buffer>((resolve) => { release = () => resolve(Buffer.from('wav')); }));
      harness = await start({}, { downloadRecording: slowDownload });

      const first = harness.post('/webhooks/voicemail', voicemailBody);
      const second = harness.post('/webhooks/voicemail', voicemailBody);
      await new Promise((resolve) => setTimeout(resolve, 50));
      release();

      const results = await Promise.all([first, second]);
      expect(results.map((r) => r.json.status).sort()).toEqual(['duplicate', 'sent']);
      expect(harness.sent).toHaveLength(1);
    });
  });

  describe('without configuration', () => {
    it('answers 503 for authenticated requests when SMTP is not configured', async () => {
      harness = await start({ problems: ['SMTP_HOST is not set'] });
      const result = await harness.post('/webhooks/missed-call', missedCallBody);

      expect(result.status).toBe(503);
      expect(String(result.json.error)).toContain('SMTP_HOST is not set');
      expect(harness.mailer.send).not.toHaveBeenCalled();
    });

    it('still answers 401 for a wrong token when SMTP is not configured', async () => {
      harness = await start({ problems: ['SMTP_HOST is not set'] });
      const result = await harness.post('/webhooks/missed-call', missedCallBody, { 'X-Callytics-Token': 'nope' });
      expect(result.status).toBe(401);
    });

    it('answers 503 for every request when no token is configured', async () => {
      harness = await start({ token: '', problems: ['NOTIFIER_TOKEN is not set'] });
      expect((await harness.post('/webhooks/missed-call', missedCallBody, {})).status).toBe(503);
      expect((await harness.post('/webhooks/missed-call', missedCallBody, { 'X-Callytics-Token': '' })).status).toBe(503);
    });
  });
});
