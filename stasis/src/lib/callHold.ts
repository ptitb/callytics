import { logEvent } from '../logger';
import { BridgePeersClient, findBridgePeers } from './bridgePeers';
import {
  ChannelSoundClient,
  HoldSettings,
  SoundHandle,
  holdSoundSpec,
  playSoundOnChannel,
} from './holdSound';

interface HoldEvent {
  channel?: { id?: string };
}

export interface CallHoldClient extends BridgePeersClient, ChannelSoundClient {
  on: (event: string, listener: (event: HoldEvent) => void) => void;
}

interface ActiveHold {
  /** Set when the hold ended while the sound was still being started. */
  ended: boolean;
  peerIds: string[];
  sounds: SoundHandle[];
}

/**
 * Plays the hold sound to the other party while an operator's phone has a call on hold.
 *
 * Asterisk does not play music on hold by itself in Stasis bridges, so without this the caller
 * hears silence when a phone (for example during an attended transfer) puts the call on hold.
 * ChannelHold fires for the channel of the phone that went on hold. The sound goes to the other
 * channels in the same bridge (the caller), never to the held channel and never to the bridge, so
 * the held phone does not hear it and the bridge recording stays clean. It stops on ChannelUnhold
 * and when the held channel or a party it plays to ends (hangup or a transfer replacing the leg).
 */
export function registerCallHold(client: CallHoldClient, loadSettings: () => Promise<HoldSettings>): void {
  const holds = new Map<string, ActiveHold>();

  const endHold = async (heldChannelId: string): Promise<void> => {
    const hold = holds.get(heldChannelId);
    if (!hold) {
      return;
    }
    holds.delete(heldChannelId);
    hold.ended = true;
    await Promise.all(hold.sounds.map((sound) => sound.stop()));
    logEvent('CallHoldEnded', { channelId: heldChannelId, peerIds: hold.peerIds });
  };

  const onHold = async (event: HoldEvent): Promise<void> => {
    const heldChannelId = String(event.channel?.id || '').trim();
    if (!heldChannelId || holds.has(heldChannelId)) {
      return;
    }
    const hold: ActiveHold = { ended: false, peerIds: [], sounds: [] };
    holds.set(heldChannelId, hold);

    const settings = await loadSettings();
    const spec = holdSoundSpec(settings);
    if (!spec) {
      return;
    }
    hold.peerIds = await findBridgePeers(client, heldChannelId);
    logEvent('CallHoldStarted', { channelId: heldChannelId, peerIds: hold.peerIds });
    for (const peerId of hold.peerIds) {
      if (hold.ended) {
        return;
      }
      const sound = await playSoundOnChannel(client, peerId, spec);
      if (!sound) {
        continue;
      }
      hold.sounds.push(sound);
      if (hold.ended) {
        await sound.stop();
      }
    }
  };

  const onChannelEnd = (event: HoldEvent): void => {
    const endedChannelId = String(event.channel?.id || '').trim();
    for (const [heldChannelId, hold] of holds) {
      if (endedChannelId === heldChannelId || hold.peerIds.includes(endedChannelId)) {
        void endHold(heldChannelId);
      }
    }
  };

  client.on('ChannelHold', (event) => void onHold(event).catch((error) => {
    logEvent('CallHoldFailed', { error: error instanceof Error ? error.message : String(error) });
  }));
  client.on('ChannelUnhold', (event) => {
    const channelId = String(event.channel?.id || '').trim();
    if (channelId) {
      void endHold(channelId);
    }
  });
  client.on('StasisEnd', onChannelEnd);
  client.on('ChannelDestroyed', onChannelEnd);
}
