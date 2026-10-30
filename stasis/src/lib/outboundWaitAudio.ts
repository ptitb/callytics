/** What the extension hears while the outbound leg is still ringing. */
export type OutboundWaitAudio = 'ringback' | 'moh';

export const DEFAULT_OUTBOUND_WAIT_AUDIO: OutboundWaitAudio = 'ringback';

/** Reads outbound_wait_audio from the backend settings; anything unknown falls back to ringback. */
export function parseOutboundWaitAudio(raw: Record<string, unknown> | undefined): OutboundWaitAudio {
  const value = raw?.outbound_wait_audio;
  return value === 'moh' || value === 'ringback' ? value : DEFAULT_OUTBOUND_WAIT_AUDIO;
}

/** The subset of the ARI channels API used for waiting audio. */
export interface OutboundWaitAudioChannels {
  ring?: (params: { channelId: string }) => Promise<void>;
  ringStop?: (params: { channelId: string }) => Promise<void>;
  startMoh?: (params: { channelId: string; mohClass?: string }) => Promise<void>;
  stopMoh?: (params: { channelId: string }) => Promise<void>;
}

/**
 * Starts the waiting audio on the extension's channel.
 * - ringback: channels.ring makes Asterisk send 180 Ringing, so the phone plays its own
 *   ringback tone. This only works while the channel is not answered yet.
 * - moh: music on hold, as before.
 * Throws when ARI rejects the request; the caller decides whether that is fatal.
 */
export async function startOutboundWaitAudio(
  channels: OutboundWaitAudioChannels,
  channelId: string,
  mode: OutboundWaitAudio,
  mohClass: string,
): Promise<void> {
  if (mode === 'ringback') {
    await channels.ring?.({ channelId });
    return;
  }
  await channels.startMoh?.({ channelId, mohClass });
}

/** Stops the waiting audio. Never throws: the channel may already be gone. */
export async function stopOutboundWaitAudio(
  channels: OutboundWaitAudioChannels,
  channelId: string,
  mode: OutboundWaitAudio,
): Promise<void> {
  try {
    if (mode === 'ringback') {
      await channels.ringStop?.({ channelId });
    } else {
      await channels.stopMoh?.({ channelId });
    }
  } catch {
    // channel may already be gone
  }
}
