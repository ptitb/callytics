/** What the extension hears while the outbound leg rings: its phone's own ringback or hold music. */
export const OUTBOUND_WAIT_AUDIO_VALUES = ['ringback', 'moh'] as const;
export type OutboundWaitAudio = (typeof OUTBOUND_WAIT_AUDIO_VALUES)[number];

export const OUTBOUND_DEFAULTS = {
  outbound_dial_without_hash: true,
  outbound_normalize_e164: true,
  outbound_country_code: '31',
  outbound_international_prefix: '00',
  outbound_wait_audio: 'ringback' as OutboundWaitAudio,
  /** 0 disables the minimum length check. */
  outbound_min_number_length: 0,
  /** Comma separated short numbers that are always allowed, such as emergency numbers. */
  outbound_allowed_short_numbers: '112',
  record_internal_calls: false,
} as const;

export const OUTBOUND_MIN_NUMBER_LENGTH_MAX = 20;

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

/** Minimum digits for an outbound number (0 = off). Returns an error message or null. */
export function validateOutboundMinNumberLength(value: unknown): string | null {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > OUTBOUND_MIN_NUMBER_LENGTH_MAX) {
    return `outbound_min_number_length must be a whole number from 0 to ${OUTBOUND_MIN_NUMBER_LENGTH_MAX}`;
  }
  return null;
}

/** Comma separated list of numbers made of digits only; an empty list is valid. Returns an error message or null. */
export function validateOutboundAllowedShortNumbers(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 255) {
    return 'outbound_allowed_short_numbers must be a comma separated list of numbers';
  }
  const entries = value.split(',').map((entry) => entry.trim()).filter((entry) => entry !== '');
  if (entries.some((entry) => !/^\d+$/.test(entry))) {
    return 'outbound_allowed_short_numbers may only contain digits and commas';
  }
  return null;
}
