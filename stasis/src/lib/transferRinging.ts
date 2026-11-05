import { logEvent } from '../logger';
import { BridgePeersClient, findBridgePeers } from './bridgePeers';
import {
  ChannelSoundClient,
  HoldSettings,
  SoundHandle,
  playSoundOnChannel,
  transferRingingSpec,
} from './holdSound';

/**
 * Blind transfer from a phone: Asterisk swaps a Local channel pair into the caller's bridge. Half
 * ;1 takes the place of the transferring phone in that bridge, half ;2 runs the dialplan that
 * rings the transfer target through Stasis (an internal or direct outbound call). Until the
 * target answers, the caller has nobody to listen to and hears silence.
 *
 * The signal used is the ;2 half itself. Its call is the one that rings the target, so its
 * answer (or its end) is exactly when the ringing sound must stop. The state of ;1 is not used:
 * a Local channel may report Up at once, before anybody answered. In an attended transfer both
 * halves enter Stasis as replacements and never start a call, so no ringing sound is played there.
 */
const LOCAL_CHANNEL_SECOND_HALF = /^(Local\/.+);2$/;

/** Retries while the ;1 half is still being swapped into the caller's bridge. */
const BRIDGE_LOOKUP_ATTEMPTS = 5;
const BRIDGE_LOOKUP_DELAY_MS = 100;

export interface TransferRingingClient extends BridgePeersClient, ChannelSoundClient {
  channels: ChannelSoundClient['channels'] & {
    list: () => Promise<Array<{ id?: string; name?: string }>>;
  };
}

/** The name of the ;1 half belonging to a Local ;2 channel name, or null for any other channel. */
export function getLocalFirstHalfName(channelName: string | undefined): string | null {
  const match = channelName ? LOCAL_CHANNEL_SECOND_HALF.exec(channelName) : null;
  return match ? `${match[1]};1` : null;
}

export interface TransferRinging {
  /** Stops the ringing sound, also when it is still being started. Never throws. */
  stop: () => Promise<void>;
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function findPeersOfFirstHalf(client: TransferRingingClient, firstHalfName: string, isStopped: () => boolean) {
  for (let attempt = 0; attempt < BRIDGE_LOOKUP_ATTEMPTS && !isStopped(); attempt += 1) {
    const channels = await client.channels.list().catch(() => []);
    const firstHalfId = channels.find((channel) => channel.name === firstHalfName)?.id;
    const peers = firstHalfId ? await findBridgePeers(client, firstHalfId) : [];
    if (peers.length > 0) {
      return peers;
    }
    await wait(BRIDGE_LOOKUP_DELAY_MS);
  }
  return [];
}

/**
 * For the channel that runs a call (channelName is its ARI channel name): when it is the ;2 half
 * of a Local pair, starts the transfer ringing sound for the caller on the ;1 side. Returns null
 * for any other channel. The caller must call stop() when the target answers or the call ends.
 */
export function startTransferRinging(
  client: TransferRingingClient,
  channelName: string | undefined,
  loadSettings: () => Promise<HoldSettings>,
): TransferRinging | null {
  const firstHalfName = getLocalFirstHalfName(channelName);
  if (!firstHalfName) {
    return null;
  }

  let stopped = false;
  const sounds: SoundHandle[] = [];

  const run = async () => {
    const spec = transferRingingSpec(await loadSettings());
    if (!spec || stopped) {
      return;
    }
    const peerIds = await findPeersOfFirstHalf(client, firstHalfName, () => stopped);
    logEvent('TransferRingingStarted', { firstHalfName, peerIds });
    for (const peerId of peerIds) {
      if (stopped) {
        return;
      }
      const sound = await playSoundOnChannel(client, peerId, spec);
      if (sound) {
        sounds.push(sound);
        if (stopped) {
          await sound.stop();
        }
      }
    }
  };
  void run().catch((error) => {
    logEvent('TransferRingingFailed', { error: error instanceof Error ? error.message : String(error) });
  });

  return {
    stop: async () => {
      stopped = true;
      await Promise.all(sounds.map((sound) => sound.stop()));
      logEvent('TransferRingingStopped', { firstHalfName });
    },
  };
}
