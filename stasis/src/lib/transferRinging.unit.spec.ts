import { EventEmitter } from 'events';
import { DEFAULT_HOLD_SETTINGS, TRANSFER_RINGBACK_MEDIA, resetChannelSounds, type HoldSettings } from './holdSound';
import { getLocalFirstHalfName, startTransferRinging } from './transferRinging';

function createClient(inBridge = true) {
  const emitter = new EventEmitter();
  return {
    emitter,
    on: (event: string, listener: (payload: never) => void) => void emitter.on(event, listener),
    removeListener: (event: string, listener: (payload: never) => void) => void emitter.removeListener(event, listener),
    Playback: () => ({ id: `pb-${Math.random()}`, stop: jest.fn().mockResolvedValue(undefined) }),
    bridges: {
      list: jest.fn().mockResolvedValue(inBridge ? [{ id: 'bridge-1', channels: ['caller-1', 'local-1'] }] : []),
    },
    channels: {
      list: jest.fn().mockResolvedValue([
        { id: 'local-1', name: 'Local/201@callytics-extensions-0000001a;1' },
        { id: 'local-2', name: 'Local/201@callytics-extensions-0000001a;2' },
      ]),
      play: jest.fn().mockResolvedValue(undefined),
      startMoh: jest.fn().mockResolvedValue(undefined),
      stopMoh: jest.fn().mockResolvedValue(undefined),
    },
  };
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 10));
const LOCAL_SECOND_HALF = 'Local/201@callytics-extensions-0000001a;2';

const start = (client: ReturnType<typeof createClient>, settings: Partial<HoldSettings> = {}, name = LOCAL_SECOND_HALF) =>
  startTransferRinging(client, name, async () => ({ ...DEFAULT_HOLD_SETTINGS, ...settings }));

describe('transfer ringing', () => {
  beforeEach(() => resetChannelSounds());

  it('finds the first half of a Local pair from the second half only', () => {
    expect(getLocalFirstHalfName(LOCAL_SECOND_HALF)).toBe('Local/201@callytics-extensions-0000001a;1');
    expect(getLocalFirstHalfName('Local/201@callytics-extensions-0000001a;1')).toBeNull();
    expect(getLocalFirstHalfName('PJSIP/101-00000012')).toBeNull();
    expect(getLocalFirstHalfName(undefined)).toBeNull();
  });

  it('does nothing for a channel that is not a Local second half', () => {
    const client = createClient();
    expect(start(client, {}, 'PJSIP/101-00000012')).toBeNull();
    expect(client.channels.play).not.toHaveBeenCalled();
  });

  it('plays the ringback tone to the caller in the bridge of the first half and stops on request', async () => {
    const client = createClient();
    const ringing = start(client);
    await flush();
    expect(client.channels.play).toHaveBeenCalledWith(
      expect.objectContaining({ channelId: 'caller-1', media: TRANSFER_RINGBACK_MEDIA }),
    );
    expect(client.channels.play).toHaveBeenCalledTimes(1);

    await ringing?.stop();
    client.emitter.emit('PlaybackFinished', { playback: { id: 'x', state: 'done' } });
    await flush();
    expect(client.channels.play).toHaveBeenCalledTimes(1);
  });

  it('plays the hold sound when the transfer ringing sound is hold', async () => {
    const client = createClient();
    const ringing = start(client, { transferRingingSound: 'hold', holdSound: 'moh' });
    await flush();
    expect(client.channels.startMoh).toHaveBeenCalledWith({ channelId: 'caller-1' });
    await ringing?.stop();
    expect(client.channels.stopMoh).toHaveBeenCalledWith({ channelId: 'caller-1' });
  });

  it('plays the uploaded hold audio when ringing follows an audio hold sound', async () => {
    const client = createClient();
    start(client, { transferRingingSound: 'hold', holdSound: 'audio', holdAudioMedia: 'sound:callytics/9' });
    await flush();
    expect(client.channels.play).toHaveBeenCalledWith(
      expect.objectContaining({ channelId: 'caller-1', media: 'sound:callytics/9' }),
    );
  });

  it('plays nothing when the transfer ringing sound is none', async () => {
    const client = createClient();
    start(client, { transferRingingSound: 'none' });
    await flush();
    expect(client.channels.play).not.toHaveBeenCalled();
    expect(client.channels.startMoh).not.toHaveBeenCalled();
  });

  it('plays nothing when stopped before the sound could start', async () => {
    const client = createClient();
    const ringing = start(client);
    await ringing?.stop();
    await flush();
    expect(client.channels.play).not.toHaveBeenCalled();
  });

  it('stops a moh sound that finished starting after the stop', async () => {
    const client = createClient();
    let finishStart: () => void = () => undefined;
    client.channels.startMoh.mockImplementation(() => new Promise<void>((resolve) => { finishStart = resolve; }));
    const ringing = start(client, { transferRingingSound: 'hold' });
    await flush();
    const stopping = ringing?.stop();
    finishStart();
    await stopping;
    await flush();
    expect(client.channels.stopMoh).toHaveBeenCalledWith({ channelId: 'caller-1' });
  });
});
