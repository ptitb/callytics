import { logEvent } from '../logger';
import { isHangupError, waitForPlaybackFinished } from './playback';

/** What the other party hears while a phone has them on hold. */
export type HoldSound = 'moh' | 'audio' | 'none';
/** What the caller hears while a transferred call rings. */
export type TransferRingingSound = 'ringback' | 'hold' | 'none';

export interface HoldSettings {
  holdSound: HoldSound;
  /** Asterisk media of the uploaded hold audio (sound:callytics/...), null when none is configured or ready. */
  holdAudioMedia: string | null;
  transferRingingSound: TransferRingingSound;
}

export const DEFAULT_HOLD_SETTINGS: HoldSettings = {
  holdSound: 'moh',
  holdAudioMedia: null,
  transferRingingSound: 'ringback',
};

/** Tone zone of the ringback tone played during a transfer. */
export const TRANSFER_TONE_ZONE = process.env.RINGBACK_TONE_ZONE || 'nl';
export const TRANSFER_RINGBACK_MEDIA = `tone:ring;tonezone=${TRANSFER_TONE_ZONE}`;

/** A sound to play to one channel: Asterisk music on hold or looped media (a file or a tone). */
export type SoundSpec = { kind: 'moh' } | { kind: 'media'; media: string };

/**
 * Reads hold_sound and transfer_ringing_sound from the backend settings. Unknown values fall back to
 * the defaults. holdAudioMedia is resolved by the caller from hold_audio_file_id.
 */
export function parseHoldSettings(
  raw: Record<string, unknown> | undefined,
  holdAudioMedia: string | null,
): HoldSettings {
  const holdSound = raw?.hold_sound;
  const transferRingingSound = raw?.transfer_ringing_sound;
  return {
    holdSound: holdSound === 'moh' || holdSound === 'audio' || holdSound === 'none'
      ? holdSound
      : DEFAULT_HOLD_SETTINGS.holdSound,
    holdAudioMedia,
    transferRingingSound: transferRingingSound === 'ringback'
      || transferRingingSound === 'hold'
      || transferRingingSound === 'none'
      ? transferRingingSound
      : DEFAULT_HOLD_SETTINGS.transferRingingSound,
  };
}

/** The sound for a held call, or null for silence. A missing audio file falls back to music on hold. */
export function holdSoundSpec(settings: HoldSettings): SoundSpec | null {
  if (settings.holdSound === 'none') {
    return null;
  }
  if (settings.holdSound === 'audio' && settings.holdAudioMedia) {
    return { kind: 'media', media: settings.holdAudioMedia };
  }
  return { kind: 'moh' };
}

/** The sound for the caller of a transfer that is still ringing, or null for silence. */
export function transferRingingSpec(settings: HoldSettings): SoundSpec | null {
  if (settings.transferRingingSound === 'none') {
    return null;
  }
  if (settings.transferRingingSound === 'hold') {
    return holdSoundSpec(settings);
  }
  return { kind: 'media', media: TRANSFER_RINGBACK_MEDIA };
}

export interface SoundHandle {
  /** Never throws: the channel may already be gone. */
  stop: () => Promise<void>;
}

interface LoopClient {
  Playback: () => { id: string; stop?: () => Promise<void> };
  on: (event: string, listener: never) => void;
  removeListener: (event: string, listener: never) => void;
}

const PLAYBACK_STOP_TIMEOUT_MS = 250;

/** Stops a playback without waiting longer than a moment for ARI. */
export async function stopPlayback(playback: { stop?: () => Promise<void> } | null): Promise<void> {
  if (!playback?.stop) {
    return;
  }
  await Promise.race([
    playback.stop().catch(() => undefined),
    new Promise<void>((resolve) => setTimeout(resolve, PLAYBACK_STOP_TIMEOUT_MS)),
  ]);
}

/**
 * Plays media again and again until stopped or until channelId is gone. play starts the playback
 * (on a bridge or on a channel) with the given playback id. Tones never finish by themselves, so
 * for them the loop just waits until it is stopped.
 */
export function startMediaLoop(
  ariClient: unknown,
  channelId: string,
  media: string,
  play: (media: string, playbackId: string) => Promise<void>,
): SoundHandle {
  const client = ariClient as LoopClient;
  let active = true;
  let currentPlayback: { id: string; stop?: () => Promise<void> } | null = null;

  const loop = async () => {
    while (active) {
      const playback = client.Playback();
      currentPlayback = playback;
      try {
        await play(media, playback.id);
        await waitForPlaybackFinished(ariClient, playback.id, channelId);
      } catch (error) {
        // Stop when the loop was stopped or the channel is gone; otherwise a
        // failing playback would restart immediately and spin.
        if (!active || isHangupError(error)) {
          break;
        }
      }
    }
  };

  void loop();

  return {
    stop: async () => {
      active = false;
      await stopPlayback(currentPlayback);
    },
  };
}

export interface ChannelSoundClient {
  Playback: () => { id: string; stop?: () => Promise<void> };
  channels: {
    play: (params: { channelId: string; media: string; playbackId?: string }) => Promise<unknown>;
    startMoh?: (params: { channelId: string; mohClass?: string }) => Promise<void>;
    stopMoh?: (params: { channelId: string }) => Promise<void>;
  };
}

/** One sound at a time per channel, so a late stop of an old sound cannot cut a newer one. */
const activeSounds = new Map<string, SoundHandle>();

/**
 * Plays a sound to one channel only (not to the whole bridge), replacing a sound that is still
 * playing on that channel. Returns null when the sound could not be started.
 */
export async function playSoundOnChannel(
  client: ChannelSoundClient,
  channelId: string,
  spec: SoundSpec,
): Promise<SoundHandle | null> {
  await activeSounds.get(channelId)?.stop();

  let inner: SoundHandle;
  if (spec.kind === 'moh') {
    try {
      await client.channels.startMoh?.({ channelId });
    } catch (error) {
      logEvent('ChannelSoundUnavailable', {
        channelId,
        kind: 'moh',
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
    inner = {
      stop: async () => {
        await client.channels.stopMoh?.({ channelId }).catch(() => undefined);
      },
    };
  } else {
    inner = startMediaLoop(client, channelId, spec.media, (media, playbackId) =>
      client.channels.play({ channelId, media, playbackId }).then(() => undefined));
  }

  let stopped = false;
  const handle: SoundHandle = {
    stop: async () => {
      if (stopped) {
        return;
      }
      stopped = true;
      if (activeSounds.get(channelId) === handle) {
        activeSounds.delete(channelId);
      }
      await inner.stop();
    },
  };
  activeSounds.set(channelId, handle);
  logEvent('ChannelSoundStarted', { channelId, kind: spec.kind, media: spec.kind === 'media' ? spec.media : null });
  return handle;
}

/** Stops whatever sound this module plays on a channel. For tests and teardown. */
export function resetChannelSounds(): void {
  activeSounds.clear();
}
