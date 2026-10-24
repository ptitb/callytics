export const EXTENSION_TRANSPORT_TYPES = ['sip', 'webrtc', 'tls'] as const;

export type ExtensionTransportType = (typeof EXTENSION_TRANSPORT_TYPES)[number];

/** Endpoint options for SIP over TLS with SRTP (SDES). Encryption is mandatory, no plain RTP fallback. */
export const TLS_ENDPOINT_FLAGS = [
  'media_encryption = sdes',
  'media_encryption_optimistic = no',
  'rtp_symmetric = yes',
];

export function normalizeTransportType(value: string | null | undefined): ExtensionTransportType {
  return value === 'webrtc' || value === 'tls' ? value : 'sip';
}

/** Name of the Asterisk transport section an extension of this type registers on. */
export function asteriskTransportName(transportType: ExtensionTransportType): string {
  switch (transportType) {
    case 'webrtc':
      return 'transport-ws';
    case 'tls':
      return 'transport-tls';
    default:
      return 'transport-udp';
  }
}
