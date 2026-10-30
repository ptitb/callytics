import {
  parseOutboundWaitAudio,
  startOutboundWaitAudio,
  stopOutboundWaitAudio,
} from './outboundWaitAudio';

function createChannels() {
  return {
    ring: jest.fn().mockResolvedValue(undefined),
    ringStop: jest.fn().mockResolvedValue(undefined),
    startMoh: jest.fn().mockResolvedValue(undefined),
    stopMoh: jest.fn().mockResolvedValue(undefined),
  };
}

describe('parseOutboundWaitAudio', () => {
  it('reads both modes', () => {
    expect(parseOutboundWaitAudio({ outbound_wait_audio: 'moh' })).toBe('moh');
    expect(parseOutboundWaitAudio({ outbound_wait_audio: 'ringback' })).toBe('ringback');
  });

  it.each([[undefined], [{}], [{ outbound_wait_audio: 'beep' }], [{ outbound_wait_audio: 1 }]])(
    'falls back to ringback for %p',
    (raw) => {
      expect(parseOutboundWaitAudio(raw as Record<string, unknown> | undefined)).toBe('ringback');
    },
  );
});

describe('startOutboundWaitAudio', () => {
  it('rings the channel in ringback mode and does not start MOH', async () => {
    const channels = createChannels();
    await startOutboundWaitAudio(channels, 'ch-1', 'ringback', 'hold');
    expect(channels.ring).toHaveBeenCalledWith({ channelId: 'ch-1' });
    expect(channels.startMoh).not.toHaveBeenCalled();
  });

  it('starts MOH with the class in moh mode and does not ring', async () => {
    const channels = createChannels();
    await startOutboundWaitAudio(channels, 'ch-1', 'moh', 'hold');
    expect(channels.startMoh).toHaveBeenCalledWith({ channelId: 'ch-1', mohClass: 'hold' });
    expect(channels.ring).not.toHaveBeenCalled();
  });

  it('propagates an ARI failure', async () => {
    const channels = createChannels();
    channels.ring.mockRejectedValue(new Error('boom'));
    await expect(startOutboundWaitAudio(channels, 'ch-1', 'ringback', 'hold')).rejects.toThrow('boom');
  });
});

describe('stopOutboundWaitAudio', () => {
  it('stops ringing in ringback mode', async () => {
    const channels = createChannels();
    await stopOutboundWaitAudio(channels, 'ch-1', 'ringback');
    expect(channels.ringStop).toHaveBeenCalledWith({ channelId: 'ch-1' });
    expect(channels.stopMoh).not.toHaveBeenCalled();
  });

  it('stops MOH in moh mode', async () => {
    const channels = createChannels();
    await stopOutboundWaitAudio(channels, 'ch-1', 'moh');
    expect(channels.stopMoh).toHaveBeenCalledWith({ channelId: 'ch-1' });
    expect(channels.ringStop).not.toHaveBeenCalled();
  });

  it.each(['ringback', 'moh'] as const)('does not throw when the channel is gone (%s)', async (mode) => {
    const channels = createChannels();
    channels.ringStop.mockRejectedValue(new Error('Channel not found'));
    channels.stopMoh.mockRejectedValue(new Error('Channel not found'));
    await expect(stopOutboundWaitAudio(channels, 'ch-1', mode)).resolves.toBeUndefined();
  });

  it('does nothing when the ARI client lacks the methods', async () => {
    await expect(stopOutboundWaitAudio({}, 'ch-1', 'ringback')).resolves.toBeUndefined();
  });
});
