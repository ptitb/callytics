/** What the extension hears while the outbound leg rings: its phone's own ringback or hold music. */
export const OUTBOUND_WAIT_AUDIO_VALUES = ['ringback', 'moh'] as const;
export type OutboundWaitAudio = (typeof OUTBOUND_WAIT_AUDIO_VALUES)[number];

export const OUTBOUND_DEFAULTS = {
  outbound_dial_without_hash: true,
  outbound_normalize_e164: true,
  outbound_country_code: '31',
  outbound_international_prefix: '00',
  outbound_wait_audio: 'ringback' as OutboundWaitAudio,
} as const;

/** Country code (digits only, 1-3 digits). Returns an error message or null. */
export function validateOutboundCountryCode(value: unknown): string | null {
  if (typeof value !== 'string' || !/^[1-9]\d{0,2}$/.test(value)) {
    return 'outbound_country_code must be 1 to 3 digits and must not start with 0';
  }
  return null;
}

/** International call prefix (digits only, 1-4 digits). Returns an error message or null. */
export function validateOutboundInternationalPrefix(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\d{1,4}$/.test(value)) {
    return 'outbound_international_prefix must be 1 to 4 digits';
  }
  return null;
}

/** Waiting audio while dialing out. Returns an error message or null. */
export function validateOutboundWaitAudio(value: unknown): string | null {
  if (!OUTBOUND_WAIT_AUDIO_VALUES.includes(value as OutboundWaitAudio)) {
    return `outbound_wait_audio must be one of: ${OUTBOUND_WAIT_AUDIO_VALUES.join(', ')}`;
  }
  return null;
}
