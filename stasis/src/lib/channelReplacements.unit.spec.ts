import { EventEmitter } from 'events';
import {
  awaitChannelReplacement,
  followCallLegReplacement,
  getReplacedChannelId,
  handleReplacementStasisStart,
  recordChannelReplacement,
  REPLACEMENT_GRACE_MS,
  resetChannelReplacements,
  waitForLegEnd,
} from './channelReplacements';

function createClient() {
  const emitter = new EventEmitter();
  return {
    emitter,
    client: {
      on: (event: string, listener: (payload: never) => void) => void emitter.on(event, listener),
      removeListener: (event: string, listener: (payload: never) => void) =>
        void emitter.removeListener(event, listener),
    },
  };
}

describe('channel replacements', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    resetChannelReplacements();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('getReplacedChannelId / handleReplacementStasisStart', () => {
    it('reads replace_channel from the event or from the resources object', () => {
      expect(getReplacedChannelId({ replace_channel: { id: 'old-1' } })).toBe('old-1');
      expect(getReplacedChannelId({}, { channel: {}, replace_channel: { id: 'old-2' } })).toBe('old-2');
      expect(getReplacedChannelId({}, { id: 'plain-channel' })).toBeNull();
    });

    it('records the replacement and tells the caller to skip all call handling', async () => {
      const handled = handleReplacementStasisStart({
        channel: { id: 'local-1' },
        replace_channel: { id: 'hunt-leg-1' },
      });

      expect(handled).toBe(true);
      await expect(awaitChannelReplacement('hunt-leg-1')).resolves.toBe('local-1');
    });

    it('leaves a normal StasisStart alone', () => {
      expect(handleReplacementStasisStart({ channel: { id: 'inbound-1' } })).toBe(false);
    });
  });

  describe('awaitChannelReplacement', () => {
    it('resolves with null after the grace period when nothing replaced the channel', async () => {
      const pending = awaitChannelReplacement('gone-1');
      await jest.advanceTimersByTimeAsync(REPLACEMENT_GRACE_MS);
      await expect(pending).resolves.toBeNull();
    });

    it('resolves when the replacement arrives within the grace period', async () => {
      const pending = awaitChannelReplacement('old-1');
      await jest.advanceTimersByTimeAsync(REPLACEMENT_GRACE_MS - 100);
      recordChannelReplacement('old-1', 'new-1');
      await expect(pending).resolves.toBe('new-1');
    });

    it('follows a chain of replacements to the current channel', async () => {
      recordChannelReplacement('a', 'b');
      recordChannelReplacement('b', 'c');
      await expect(awaitChannelReplacement('a')).resolves.toBe('c');
    });
  });

  describe('waitForLegEnd', () => {
    it('resolves after the grace period when a leg ends without a replacement', async () => {
      const { client, emitter } = createClient();
      const onResolved = jest.fn();
      void waitForLegEnd(client, ['caller', 'agent']).then(onResolved);

      emitter.emit('StasisEnd', { channel: { id: 'caller' } });
      emitter.emit('ChannelDestroyed', { channel: { id: 'caller' } });
      await jest.advanceTimersByTimeAsync(REPLACEMENT_GRACE_MS - 1);
      expect(onResolved).not.toHaveBeenCalled();

      await jest.advanceTimersByTimeAsync(1);
      expect(onResolved).toHaveBeenCalledTimes(1);
      expect(onResolved).toHaveBeenCalledWith({ endedIndex: 0, channelIds: ['caller', 'agent'] });
      expect(emitter.listenerCount('StasisEnd')).toBe(0);
      expect(emitter.listenerCount('ChannelDestroyed')).toBe(0);
    });

    it('keeps waiting on the replacement when the replacement is recorded before the leg ends', async () => {
      const { client, emitter } = createClient();
      const onResolved = jest.fn();
      void waitForLegEnd(client, ['caller', 'agent']).then(onResolved);

      recordChannelReplacement('agent', 'local-1');
      emitter.emit('StasisEnd', { channel: { id: 'agent' } });
      await jest.advanceTimersByTimeAsync(REPLACEMENT_GRACE_MS * 2);
      expect(onResolved).not.toHaveBeenCalled();

      emitter.emit('StasisEnd', { channel: { id: 'caller' } });
      await jest.advanceTimersByTimeAsync(REPLACEMENT_GRACE_MS);
      expect(onResolved).toHaveBeenCalledWith({ endedIndex: 0, channelIds: ['caller', 'local-1'] });
    });

    it('follows a replacement that arrives just after the leg ended', async () => {
      const { client, emitter } = createClient();
      const onResolved = jest.fn();
      void waitForLegEnd(client, ['caller', 'agent']).then(onResolved);

      emitter.emit('StasisEnd', { channel: { id: 'agent' } });
      await jest.advanceTimersByTimeAsync(200);
      recordChannelReplacement('agent', 'local-1');
      await jest.advanceTimersByTimeAsync(REPLACEMENT_GRACE_MS * 2);
      expect(onResolved).not.toHaveBeenCalled();

      emitter.emit('ChannelDestroyed', { channel: { id: 'local-1' } });
      await jest.advanceTimersByTimeAsync(REPLACEMENT_GRACE_MS);
      expect(onResolved).toHaveBeenCalledWith({ endedIndex: 1, channelIds: ['caller', 'local-1'] });
    });

    it('ignores channels that are not tracked', async () => {
      const { client, emitter } = createClient();
      const onResolved = jest.fn();
      void waitForLegEnd(client, ['caller', 'agent']).then(onResolved);

      emitter.emit('StasisEnd', { channel: { id: 'someone-else' } });
      await jest.advanceTimersByTimeAsync(REPLACEMENT_GRACE_MS * 2);
      expect(onResolved).not.toHaveBeenCalled();
    });
  });

  describe('followCallLegReplacement', () => {
    function createCall() {
      const call = { inboundChannelId: 'ext-101', outboundChannelId: 'ext-201' as string | null };
      const registry = new Map([
        ['ext-101', call],
        ['ext-201', call],
      ]);
      return { call, registry };
    }

    it('moves the call to the replacing channel', async () => {
      const { call, registry } = createCall();
      recordChannelReplacement('ext-101', 'local-1');

      await expect(followCallLegReplacement(call, registry, 'ext-101')).resolves.toBe(true);

      expect(call.inboundChannelId).toBe('local-1');
      expect(call.outboundChannelId).toBe('ext-201');
      expect(registry.get('local-1')).toBe(call);
      expect(registry.has('ext-101')).toBe(false);
    });

    it('treats the second end event of an already swapped leg as handled', async () => {
      const { call, registry } = createCall();
      recordChannelReplacement('ext-201', 'local-2');

      await followCallLegReplacement(call, registry, 'ext-201');
      await expect(followCallLegReplacement(call, registry, 'ext-201')).resolves.toBe(true);

      expect(call.outboundChannelId).toBe('local-2');
    });

    it('returns false when the leg was not replaced, so the call is cleaned up as before', async () => {
      const { call, registry } = createCall();
      const pending = followCallLegReplacement(call, registry, 'ext-101');
      await jest.advanceTimersByTimeAsync(REPLACEMENT_GRACE_MS);

      await expect(pending).resolves.toBe(false);
      expect(call.inboundChannelId).toBe('ext-101');
      expect(registry.get('ext-101')).toBe(call);
    });
  });
});
