import { spawn as nodeSpawn, SpawnOptions, ChildProcess } from 'child_process';

export type SpawnFn = (command: string, args: string[], options: SpawnOptions) => ChildProcess;

export interface ConvertOptions {
  ffmpegPath?: string;
  timeoutMs?: number;
  spawn?: SpawnFn;
}

/** Speech quality: mono, 16 kHz, 64 kbit/s. A one minute voicemail is about 480 KB. */
export const FFMPEG_ARGS = [
  '-hide_banner',
  '-loglevel', 'error',
  '-i', 'pipe:0',
  '-vn',
  '-ac', '1',
  '-ar', '16000',
  '-codec:a', 'libmp3lame',
  '-b:a', '64k',
  '-f', 'mp3',
  'pipe:1',
];

/**
 * Converts a WAV buffer to MP3 with ffmpeg, streaming through stdin and stdout.
 * Rejects when ffmpeg is missing, fails, times out or produces no output.
 */
export function convertWavToMp3(wav: Buffer, options: ConvertOptions = {}): Promise<Buffer> {
  const { ffmpegPath = 'ffmpeg', timeoutMs = 30_000, spawn = nodeSpawn } = options;

  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, FFMPEG_ARGS, { stdio: ['pipe', 'pipe', 'pipe'] });
    const output: Buffer[] = [];
    const errors: Buffer[] = [];
    let settled = false;

    const finish = (error: Error | null, result?: Buffer) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(result as Buffer);
    };

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(new Error(`ffmpeg timed out after ${timeoutMs} ms`));
    }, timeoutMs);

    child.stdout?.on('data', (chunk: Buffer) => output.push(chunk));
    child.stderr?.on('data', (chunk: Buffer) => errors.push(chunk));
    child.on('error', (error) => finish(new Error(`ffmpeg could not be started: ${error.message}`)));
    child.on('close', (code) => {
      const mp3 = Buffer.concat(output);
      if (code === 0 && mp3.length > 0) {
        finish(null, mp3);
      } else {
        const detail = Buffer.concat(errors).toString('utf8').trim().slice(0, 300);
        finish(new Error(`ffmpeg exited with code ${code}${detail ? `: ${detail}` : ''}`));
      }
    });

    // A write error (for example EPIPE when ffmpeg exits early) is reported through "close".
    child.stdin?.on('error', () => undefined);
    child.stdin?.end(wav);
  });
}
