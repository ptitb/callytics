interface BridgeInfo {
  id?: string;
  channels?: string[];
}

export interface BridgePeersClient {
  bridges: { list: () => Promise<BridgeInfo[]> };
}

/**
 * The other channels in the bridge that channelId is in: for a held operator leg this is the
 * caller. Empty when the channel is in no bridge or ARI fails.
 */
export async function findBridgePeers(client: BridgePeersClient, channelId: string): Promise<string[]> {
  try {
    const bridges = await client.bridges.list();
    const bridge = bridges.find((candidate) => candidate.channels?.includes(channelId));
    return (bridge?.channels ?? []).filter((id) => id !== channelId);
  } catch {
    return [];
  }
}
