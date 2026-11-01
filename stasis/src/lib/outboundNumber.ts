/** Settings that control how a dialed number is converted before it goes to the trunk. */
export interface OutboundNumberSettings {
  normalizeE164: boolean;
  /** Country code without + or leading zeros, used for national numbers (0X...). */
  countryCode: string;
  /** Prefix that marks an international number, for example 00. */
  internationalPrefix: string;
  /** Numbers with fewer digits are never dialed out. 0 disables the check. */
  minLength: number;
  /** Short numbers (for example emergency numbers) that are allowed despite minLength. */
  allowedShortNumbers: string[];
}

export const DEFAULT_OUTBOUND_NUMBER_SETTINGS: OutboundNumberSettings = {
  normalizeE164: true,
  countryCode: '31',
  internationalPrefix: '00',
  minLength: 0,
  allowedShortNumbers: ['112'],
};

/** Splits a comma separated list of numbers; entries that are not plain digits are dropped. */
export function parseShortNumberList(value: unknown): string[] | null {
  if (typeof value !== 'string') {
    return null;
  }
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => /^\d+$/.test(entry));
}

/**
 * Reads the outbound_* keys of the backend settings. Missing or invalid
 * values fall back to the defaults, so a bad value never blocks a call.
 */
export function parseOutboundNumberSettings(raw: Record<string, unknown> | undefined): OutboundNumberSettings {
  const countryCode = String(raw?.outbound_country_code ?? '');
  const internationalPrefix = String(raw?.outbound_international_prefix ?? '');
  return {
    normalizeE164: typeof raw?.outbound_normalize_e164 === 'boolean'
      ? raw.outbound_normalize_e164
      : DEFAULT_OUTBOUND_NUMBER_SETTINGS.normalizeE164,
    countryCode: /^[1-9]\d{0,2}$/.test(countryCode) ? countryCode : DEFAULT_OUTBOUND_NUMBER_SETTINGS.countryCode,
    internationalPrefix: /^\d{1,4}$/.test(internationalPrefix)
      ? internationalPrefix
      : DEFAULT_OUTBOUND_NUMBER_SETTINGS.internationalPrefix,
    minLength: typeof raw?.outbound_min_number_length === 'number'
      && Number.isInteger(raw.outbound_min_number_length)
      && raw.outbound_min_number_length >= 0
      ? raw.outbound_min_number_length
      : DEFAULT_OUTBOUND_NUMBER_SETTINGS.minLength,
    allowedShortNumbers: parseShortNumberList(raw?.outbound_allowed_short_numbers)
      ?? DEFAULT_OUTBOUND_NUMBER_SETTINGS.allowedShortNumbers,
  };
}

/**
 * Tells whether a dialed number may leave through a trunk. A number with fewer
 * digits than minLength is blocked unless it is in the allowed short numbers.
 * Checked on the number as dialed, before E.164 conversion.
 */
export function isOutboundNumberAllowed(dialedNumber: string, settings: OutboundNumberSettings): boolean {
  if (settings.minLength <= 0) {
    return true;
  }
  const digits = dialedNumber.replace(/\D/g, '');
  return digits.length >= settings.minLength || settings.allowedShortNumbers.includes(digits);
}

/**
 * Converts a dialed number to E.164 for the outbound trunk.
 *
 * - Spaces, dashes, dots and parentheses are removed.
 * - +X... stays as it is.
 * - <international prefix>X... becomes +X...
 * - 0X... (national trunk prefix) becomes +<country code>X...
 * - Anything else, such as short numbers like 112, stays unchanged.
 *
 * With normalizeE164 off the number is returned untouched.
 */
export function normalizeOutboundNumber(raw: string, settings: OutboundNumberSettings): string {
  if (!settings.normalizeE164) {
    return raw;
  }

  const cleaned = raw.replace(/[\s\-.()]/g, '');
  if (!/^\+?\d+$/.test(cleaned) || cleaned.startsWith('+')) {
    return cleaned;
  }
  // The international prefix is checked first because it usually starts with 0 too.
  if (cleaned.startsWith(settings.internationalPrefix)) {
    const rest = cleaned.slice(settings.internationalPrefix.length);
    return rest ? `+${rest}` : cleaned;
  }
  if (cleaned.startsWith('0') && cleaned.length > 1) {
    return `+${settings.countryCode}${cleaned.slice(1)}`;
  }
  return cleaned;
}

/**
 * Takes the number out of the dialed extension of a direct outbound call
 * ("#0612345678" gives "0612345678"). Returns null when what is left is
 * not a number, which can only be digits with an optional leading +.
 */
export function extractDialedNumber(dialedExten: string): string | null {
  const number = dialedExten.trim().replace(/^#/, '');
  return /^\+?\d+$/.test(number) ? number : null;
}
