import { EventEmitter } from 'events';
import { registerCallHold } from './callHold';
import { DEFAULT_HOLD_SETTINGS, resetChannelSounds, type HoldSettings } from './holdSound';

function createClient(bridgeChannels: string[] = ['operator-1', 'caller-1']) {
  const emitter = new EventEmitter();
  return {
    emitter,
    on: (event: string, listener: (payload: never) => void) => void emitter.on(event, listener),
    removeListener: (event: string, listener: (payload: never) => void) => void emitter.removeListener(event, listener),
    Playback: () => ({ id: `pb-${Math.random()}`, stop: jest.fn().mockResolvedValue(undefined) }),
    bridges: { list: jest.fn().mockResolvedValue([{ id: 'bridge-1', channels: bridgeChannels }, { id: 'other', channels: ['x'] }]) },
    channels: {
      play: jest.fn().mockResolvedValue(undefined),
      startMoh: jest.fn().mockResolvedValue(undefined),
      stopMoh: jest.fn().mockResolvedValue(undefined),
    },
  };
}

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

function setup(settings: Partial<HoldSettings> = {}, bridgeChannels?: string[]) {
  const client = createClient(bridgeChannels);
  registerCallHold(client, async () => ({ ...DEFAULT_HOLD_SETTINGS, ...settings }));
  return client;
}

describe('call hold', () => {
  beforeEach(() => resetChannelSounds());

  it('plays music on hold to the caller, not to the held phone, and stops on unhold', async () => {
    const client = setup();
    client.emitter.emit('ChannelHold', { channel: { id: 'operator-1' } });
    await flush();
    expect(client.channels.startMoh).toHaveBeenCalledTimes(1);
    expect(client.channels.startMoh).toHaveBeenCalledWith({ channelId: 'caller-1' });

    client.emitter.emit('ChannelUnhold', { channel: { id: 'operator-1' } });
    await flush();
    expect(client.channels.stopMoh).toHaveBeenCalledWith({ channelId: 'caller-1' });
  });

  it('plays the uploaded hold audio on the caller channel', async () => {
    const client = setup({ holdSound: 'audio', holdAudioMedia: 'sound:callytics/9' });
    client.emitter.emit('ChannelHold', { channel: { id: 'operator-1' } });
    await flush();
    expect(client.channels.play).toHaveBeenCalledWith(
      expect.objectContaining({ channelId: 'caller-1', media: 'sound:callytics/9' }),
    );
    expect(client.channels.startMoh).not.toHaveBeenCalled();
  });

  it('plays nothing when the hold sound is none', async () => {
    const client = setup({ holdSound: 'none' });
    client.emitter.emit('ChannelHold', { channel: { id: 'operator-1' } });
    await flush();
    expect(client.channels.startMoh).not.toHaveBeenCalled();
    expect(client.channels.play).not.toHaveBeenCalled();
  });

  it('plays nothing when the held channel is in no bridge', async () => {
    const client = setup({}, ['a', 'b']);
    client.emitter.emit('ChannelHold', { channel: { id: 'operator-1' } });
    await flush();
    expect(client.channels.startMoh).not.toHaveBeenCalled();
  });

  it('plays to every other party in the bridge', async () => {
    const client = setup({}, ['operator-1', 'caller-1', 'caller-2']);
    client.emitter.emit('ChannelHold', { channel: { id: 'operator-1' } });
    await flush();
    expect(client.channels.startMoh.mock.calls.map(([params]) => params.channelId)).toEqual(['caller-1', 'caller-2']);
  });

  it('stops when the held channel ends or is replaced', async () => {
    const client = setup();
    client.emitter.emit('ChannelHold', { channel: { id: 'operator-1' } });
    await flush();
    client.emitter.emit('StasisEnd', { channel: { id: 'operator-1' } });
    await flush();
    expect(client.channels.stopMoh).toHaveBeenCalledWith({ channelId: 'caller-1' });
  });

  it('stops when the caller ends', async () => {
    const client = setup({ holdSound: 'audio', holdAudioMedia: 'sound:callytics/9' });
    client.emitter.emit('ChannelHold', { channel: { id: 'operator-1' } });
    await flush();
    client.emitter.emit('ChannelDestroyed', { channel: { id: 'caller-1' } });
    await flush();
    expect(client.channels.play).toHaveBeenCalledTimes(1);
  });

  it('ignores a second hold event while already on hold and ends of unrelated channels', async () => {
    const client = setup();
    client.emitter.emit('ChannelHold', { channel: { id: 'operator-1' } });
    client.emitter.emit('ChannelHold', { channel: { id: 'operator-1' } });
    await flush();
    client.emitter.emit('StasisEnd', { channel: { id: 'unrelated' } });
    await flush();
    expect(client.channels.startMoh).toHaveBeenCalledTimes(1);
    expect(client.channels.stopMoh).not.toHaveBeenCalled();
  });

  it('does not start a sound when the unhold arrives while the settings load', async () => {
    const client = createClient();
    let release: (value: HoldSettings) => void = () => undefined;
    registerCallHold(client, () => new Promise<HoldSettings>((resolve) => { release = resolve; }));
    client.emitter.emit('ChannelHold', { channel: { id: 'operator-1' } });
    client.emitter.emit('ChannelUnhold', { channel: { id: 'operator-1' } });
    release(DEFAULT_HOLD_SETTINGS);
    await flush();
    expect(client.channels.startMoh).not.toHaveBeenCalled();
  });
});
