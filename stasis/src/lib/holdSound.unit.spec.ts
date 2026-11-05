import { EventEmitter } from 'events';
import {
  DEFAULT_HOLD_SETTINGS,
  TRANSFER_RINGBACK_MEDIA,
  holdSoundSpec,
  parseHoldSettings,
  playSoundOnChannel,
  resetChannelSounds,
  transferRingingSpec,
  type HoldSettings,
} from './holdSound';

const settings = (overrides: Partial<HoldSettings>): HoldSettings => ({ ...DEFAULT_HOLD_SETTINGS, ...overrides });

function createClient() {
  const emitter = new EventEmitter();
  let playbackCount = 0;
  const playbacks: Array<{ id: string; stop: jest.Mock }> = [];
  return {
    emitter,
    playbacks,
    on: (event: string, listener: (payload: never) => void) => void emitter.on(event, listener),
    removeListener: (event: string, listener: (payload: never) => void) => void emitter.removeListener(event, listener),
    Playback: () => {
      playbackCount += 1;
      const playback = { id: `pb-${playbackCount}`, stop: jest.fn().mockResolvedValue(undefined) };
      playbacks.push(playback);
      return playback;
    },
    channels: {
      play: jest.fn().mockResolvedValue(undefined),
      startMoh: jest.fn().mockResolvedValue(undefined),
      stopMoh: jest.fn().mockResolvedValue(undefined),
    },
  };
}

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

describe('hold sound settings', () => {
  it('reads the settings and falls back to the defaults for unknown values', () => {
    expect(parseHoldSettings({ hold_sound: 'audio', transfer_ringing_sound: 'hold' }, 'sound:callytics/9')).toEqual({
      holdSound: 'audio',
      holdAudioMedia: 'sound:callytics/9',
      transferRingingSound: 'hold',
    });
    expect(parseHoldSettings({ hold_sound: 'beep', transfer_ringing_sound: 1 }, null)).toEqual(DEFAULT_HOLD_SETTINGS);
    expect(parseHoldSettings(undefined, null)).toEqual(DEFAULT_HOLD_SETTINGS);
  });

  it('picks the hold sound', () => {
    expect(holdSoundSpec(settings({ holdSound: 'moh' }))).toEqual({ kind: 'moh' });
    expect(holdSoundSpec(settings({ holdSound: 'none' }))).toBeNull();
    expect(holdSoundSpec(settings({ holdSound: 'audio', holdAudioMedia: 'sound:callytics/9' })))
      .toEqual({ kind: 'media', media: 'sound:callytics/9' });
    // The audio file is missing or not converted yet.
    expect(holdSoundSpec(settings({ holdSound: 'audio', holdAudioMedia: null }))).toEqual({ kind: 'moh' });
  });

  it('picks the transfer ringing sound', () => {
    expect(transferRingingSpec(settings({ transferRingingSound: 'ringback' })))
      .toEqual({ kind: 'media', media: TRANSFER_RINGBACK_MEDIA });
    expect(transferRingingSpec(settings({ transferRingingSound: 'none' }))).toBeNull();
    expect(transferRingingSpec(settings({ transferRingingSound: 'hold', holdSound: 'moh' }))).toEqual({ kind: 'moh' });
    expect(transferRingingSpec(settings({ transferRingingSound: 'hold', holdSound: 'none' }))).toBeNull();
    expect(TRANSFER_RINGBACK_MEDIA).toMatch(/^tone:ring;tonezone=\w+$/);
  });
});

describe('playSoundOnChannel', () => {
  beforeEach(() => resetChannelSounds());

  it('starts and stops music on hold on the channel', async () => {
    const client = createClient();
    const handle = await playSoundOnChannel(client, 'caller-1', { kind: 'moh' });
    expect(client.channels.startMoh).toHaveBeenCalledWith({ channelId: 'caller-1' });
    await handle?.stop();
    expect(client.channels.stopMoh).toHaveBeenCalledWith({ channelId: 'caller-1' });
  });

  it('returns null when music on hold cannot start', async () => {
    const client = createClient();
    client.channels.startMoh.mockRejectedValue(new Error('no moh'));
    await expect(playSoundOnChannel(client, 'caller-1', { kind: 'moh' })).resolves.toBeNull();
  });

  it('loops media on the channel until stopped', async () => {
    const client = createClient();
    const handle = await playSoundOnChannel(client, 'caller-1', { kind: 'media', media: 'sound:callytics/9' });
    await flush();
    expect(client.channels.play).toHaveBeenCalledWith({
      channelId: 'caller-1',
      media: 'sound:callytics/9',
      playbackId: 'pb-1',
    });

    client.emitter.emit('PlaybackFinished', { playback: { id: 'pb-1', state: 'done' } });
    await flush();
    expect(client.channels.play).toHaveBeenCalledTimes(2);

    await handle?.stop();
    client.emitter.emit('PlaybackFinished', { playback: { id: 'pb-2', state: 'done' } });
    await flush();
    expect(client.playbacks[1].stop).toHaveBeenCalled();
    expect(client.channels.play).toHaveBeenCalledTimes(2);
  });

  it('stops the loop when the channel ends', async () => {
    const client = createClient();
    await playSoundOnChannel(client, 'caller-1', { kind: 'media', media: 'sound:callytics/9' });
    await flush();
    client.emitter.emit('StasisEnd', { channel: { id: 'caller-1' } });
    await flush();
    expect(client.channels.play).toHaveBeenCalledTimes(1);
  });

  it('lets a newer sound replace the old one and ignores the late stop of the old one', async () => {
    const client = createClient();
    const first = await playSoundOnChannel(client, 'caller-1', { kind: 'moh' });
    const second = await playSoundOnChannel(client, 'caller-1', { kind: 'moh' });
    expect(client.channels.stopMoh).toHaveBeenCalledTimes(1);
    await first?.stop();
    expect(client.channels.stopMoh).toHaveBeenCalledTimes(1);
    await second?.stop();
    expect(client.channels.stopMoh).toHaveBeenCalledTimes(2);
  });
});
