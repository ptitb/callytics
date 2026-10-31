import { ChildProcess, spawnSync } from 'child_process';
import { EventEmitter } from 'events';
import { PassThrough } from 'stream';
import { convertWavToMp3, FFMPEG_ARGS, SpawnFn } from './mp3';

function fakeFfmpeg(behaviour: (child: FakeChild) => void): { spawn: SpawnFn; calls: Array<{ command: string; args: string[] }> } {
  const calls: Array<{ command: string; args: string[] }> = [];
  const spawn: SpawnFn = (command, args) => {
    calls.push({ command, args });
    const child = new EventEmitter() as FakeChild;
    child.stdin = new PassThrough();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = jest.fn();
    setImmediate(() => behaviour(child));
    return child as unknown as ChildProcess;
  };
  return { spawn, calls };
}

interface FakeChild extends EventEmitter {
  stdin: PassThrough;
  stdout: PassThrough;
  stderr: PassThrough;
  kill: jest.Mock;
}

describe('convertWavToMp3', () => {
  it('returns the mp3 bytes written by ffmpeg', async () => {
    const { spawn, calls } = fakeFfmpeg((child) => {
      child.stdout.write(Buffer.from('mp3-data'));
      child.emit('close', 0);
    });

    const result = await convertWavToMp3(Buffer.from('wav'), { spawn, ffmpegPath: '/usr/bin/ffmpeg' });

    expect(result.toString()).toBe('mp3-data');
    expect(calls[0].command).toBe('/usr/bin/ffmpeg');
    expect(calls[0].args).toEqual(FFMPEG_ARGS);
    expect(FFMPEG_ARGS).toEqual(expect.arrayContaining(['libmp3lame', '-ac', '1']));
  });

  it('rejects with the ffmpeg error output on a non-zero exit', async () => {
    const { spawn } = fakeFfmpeg((child) => {
      child.stderr.write('Invalid data found');
      child.emit('close', 1);
    });
    await expect(convertWavToMp3(Buffer.from('wav'), { spawn })).rejects.toThrow('exit');
    await expect(
      convertWavToMp3(Buffer.from('wav'), {
        spawn: fakeFfmpeg((child) => {
          child.stderr.write('Invalid data found');
          child.emit('close', 1);
        }).spawn,
      }),
    ).rejects.toThrow('Invalid data found');
  });

  it('rejects when ffmpeg produces no output', async () => {
    const { spawn } = fakeFfmpeg((child) => child.emit('close', 0));
    await expect(convertWavToMp3(Buffer.from('wav'), { spawn })).rejects.toThrow('code 0');
  });

  it('rejects when ffmpeg is not installed', async () => {
    const { spawn } = fakeFfmpeg((child) => child.emit('error', new Error('spawn ffmpeg ENOENT')));
    await expect(convertWavToMp3(Buffer.from('wav'), { spawn })).rejects.toThrow('could not be started');
  });

  it('kills ffmpeg after the timeout', async () => {
    let killed: jest.Mock | undefined;
    const { spawn } = fakeFfmpeg((child) => {
      killed = child.kill;
    });
    await expect(convertWavToMp3(Buffer.from('wav'), { spawn, timeoutMs: 20 })).rejects.toThrow('timed out');
    expect(killed).toHaveBeenCalledWith('SIGKILL');
  });
});

// Real ffmpeg round trip, skipped where ffmpeg is not installed.
const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0;
(hasFfmpeg ? describe : describe.skip)('convertWavToMp3 with real ffmpeg', () => {
  function silentWav(seconds: number): Buffer {
    const sampleRate = 8000;
    const data = Buffer.alloc(sampleRate * 2 * seconds);
    const header = Buffer.alloc(44);
    header.write('RIFF', 0);
    header.writeUInt32LE(36 + data.length, 4);
    header.write('WAVEfmt ', 8);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(1, 22);
    header.writeUInt32LE(sampleRate, 24);
    header.writeUInt32LE(sampleRate * 2, 28);
    header.writeUInt16LE(2, 32);
    header.writeUInt16LE(16, 34);
    header.write('data', 36);
    header.writeUInt32LE(data.length, 40);
    return Buffer.concat([header, data]);
  }

  it('converts an 8 kHz mono WAV to an MP3', async () => {
    const mp3 = await convertWavToMp3(silentWav(2));
    const startsWithFrameOrId3 = mp3.subarray(0, 3).toString() === 'ID3' || (mp3[0] === 0xff && (mp3[1] & 0xe0) === 0xe0);
    expect(startsWithFrameOrId3).toBe(true);
  });
});
