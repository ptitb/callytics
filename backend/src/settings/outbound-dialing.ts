export const OUTBOUND_DEFAULTS = {
  outbound_dial_without_hash: true,
  outbound_normalize_e164: true,
  outbound_country_code: '31',
  outbound_international_prefix: '00',
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
