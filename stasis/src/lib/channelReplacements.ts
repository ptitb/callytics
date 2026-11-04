import { logEvent } from '../logger';

/**
 * When a phone transfers a call (SIP REFER, attended or blind) while its leg sits in a Stasis
 * bridge, Asterisk cannot merge the bridges. It creates a Local channel pair and swaps one half
 * into the bridge in place of the transferring channel. That half enters Stasis with a StasisStart
 * carrying replace_channel. Code that tracks the call legs must follow such a replacement instead
 * of treating the old channel ending as a hangup.
 */

/** How long a channel that just ended is given to turn out to be replaced. */
export const REPLACEMENT_GRACE_MS = 500;
/** Replacements are only needed around the moment the old channel ends. */
const REPLACEMENT_RETENTION_MS = 60_000;

type ReplacementListener = (newChannelId: string) => void;

const replacedBy = new Map<string, string>();
const listeners = new Map<string, Set<ReplacementListener>>();

/**
 * Reads the id of the channel a StasisStart replaces. ari-client passes the event JSON as the
 * first listener argument and { channel, replace_channel } as the resources argument.
 */
export function getReplacedChannelId(
  event: { replace_channel?: { id?: string } },
  resources?: unknown,
): string | null {
  const fromEvent = event.replace_channel?.id;
  const fromResources = (resources as { replace_channel?: { id?: string } } | undefined)?.replace_channel?.id;
  return fromEvent || fromResources || null;
}

/**
 * Handles a StasisStart that replaces another channel: records the replacement and returns true.
 * Such a channel continues an existing call, so the caller must not start any call handling for it.
 */
export function handleReplacementStasisStart(
  event: { channel?: { id?: string }; replace_channel?: { id?: string } },
  resources?: unknown,
): boolean {
  const replacedChannelId = getReplacedChannelId(event, resources);
  if (!replacedChannelId) {
    return false;
  }
  if (event.channel?.id) {
    recordChannelReplacement(replacedChannelId, event.channel.id);
  }
  return true;
}

/** Follows replacements until the channel that is current now. Null when the channel was not replaced. */
function findCurrentChannelId(channelId: string): string | null {
  let current = replacedBy.get(channelId) ?? null;
  const seen = new Set<string>([channelId]);
  while (current && replacedBy.has(current) && !seen.has(current)) {
    seen.add(current);
    current = replacedBy.get(current) ?? current;
  }
  return current;
}

export function recordChannelReplacement(replacedChannelId: string, newChannelId: string): void {
  replacedBy.set(replacedChannelId, newChannelId);
  logEvent('ChannelReplaced', { replacedChannelId, newChannelId });

  const retention = setTimeout(() => replacedBy.delete(replacedChannelId), REPLACEMENT_RETENTION_MS);
  retention.unref?.();

  const waiting = listeners.get(replacedChannelId);
  if (waiting) {
    listeners.delete(replacedChannelId);
    const currentId = findCurrentChannelId(replacedChannelId) ?? newChannelId;
    waiting.forEach((listener) => listener(currentId));
  }
}

/**
 * Resolves with the channel that replaced channelId, or null when none did within graceMs.
 * The replacing StasisStart can arrive just after the old channel's StasisEnd.
 */
export function awaitChannelReplacement(
  channelId: string,
  graceMs: number = REPLACEMENT_GRACE_MS,
): Promise<string | null> {
  const known = findCurrentChannelId(channelId);
  if (known) {
    return Promise.resolve(known);
  }
  return new Promise((resolve) => {
    const listener: ReplacementListener = (newChannelId) => {
      clearTimeout(timer);
      resolve(newChannelId);
    };
    const timer = setTimeout(() => {
      listeners.get(channelId)?.delete(listener);
      resolve(null);
    }, graceMs);
    const set = listeners.get(channelId) ?? new Set<ReplacementListener>();
    set.add(listener);
    listeners.set(channelId, set);
  });
}

interface LegEventClient {
  on: (event: string, listener: (event: { channel?: { id?: string } }) => void) => void;
  removeListener: (event: string, listener: (event: { channel?: { id?: string } }) => void) => void;
}

export interface LegEndResult {
  /** Index in the tracked list of the leg that ended without being replaced. */
  endedIndex: number;
  /** The tracked channel ids at that moment, with replacements applied. Hang up the peer through these. */
  channelIds: string[];
}

/**
 * Waits until one of the tracked legs ends for good. A leg that ends but is replaced by another
 * channel (transfer) is swapped for its replacement and tracking continues. Resolves after the
 * grace period when an ended leg was not replaced.
 */
export function waitForLegEnd(
  client: LegEventClient,
  channelIds: string[],
  graceMs: number = REPLACEMENT_GRACE_MS,
): Promise<LegEndResult> {
  return new Promise((resolve) => {
    const tracked = [...channelIds];
    const checking = new Set<string>();
    let settled = false;

    const cleanup = () => {
      client.removeListener('StasisEnd', onEnd);
      client.removeListener('ChannelDestroyed', onEnd);
    };

    const onEnd = (event: { channel?: { id?: string } }) => {
      const endedChannelId = String(event.channel?.id || '').trim();
      const index = tracked.indexOf(endedChannelId);
      // StasisEnd and ChannelDestroyed both report the same end: handle it once.
      if (settled || index === -1 || checking.has(endedChannelId)) {
        return;
      }
      checking.add(endedChannelId);
      void awaitChannelReplacement(endedChannelId, graceMs).then((newChannelId) => {
        checking.delete(endedChannelId);
        if (settled) {
          return;
        }
        if (newChannelId) {
          tracked[index] = newChannelId;
          logEvent('ChannelReplacementFollowed', { replacedChannelId: endedChannelId, newChannelId });
          return;
        }
        settled = true;
        cleanup();
        resolve({ endedIndex: index, channelIds: [...tracked] });
      });
    };

    client.on('StasisEnd', onEnd);
    client.on('ChannelDestroyed', onEnd);
  });
}

interface TwoLegCall {
  inboundChannelId: string;
  outboundChannelId: string | null;
}

/**
 * For a call that tracks its two legs by channel id (internal and direct outbound calls): when
 * endedChannelId was replaced, points the call and the channel registry at the new channel.
 * Returns false when the leg was not replaced, so the call has to be cleaned up.
 */
export async function followCallLegReplacement<T extends TwoLegCall>(
  call: T,
  registry: Map<string, T>,
  endedChannelId: string,
  graceMs: number = REPLACEMENT_GRACE_MS,
): Promise<boolean> {
  const newChannelId = await awaitChannelReplacement(endedChannelId, graceMs);
  if (!newChannelId) {
    return false;
  }
  if (call.inboundChannelId === endedChannelId) {
    call.inboundChannelId = newChannelId;
  } else if (call.outboundChannelId === endedChannelId) {
    call.outboundChannelId = newChannelId;
  } else {
    // Already swapped by the other end event (StasisEnd and ChannelDestroyed both arrive).
    return true;
  }
  registry.delete(endedChannelId);
  registry.set(newChannelId, call);
  logEvent('CallLegReplaced', { replacedChannelId: endedChannelId, newChannelId });
  return true;
}

/** Forgets all recorded replacements. For tests. */
export function resetChannelReplacements(): void {
  replacedBy.clear();
  listeners.clear();
}
