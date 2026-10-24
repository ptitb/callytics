const SEPARATORS = /[\s\-.()/]/g;
const E164_PATTERN = /^\+?\d{1,15}$/;
const DIALPLAN_PATTERN = /^_[0-9XZN[\]\-.!+#*]+$/;
const PHONE_LIKE = /^\+?[\d\s\-.()/]+$/;

/**
 * Strips spaces and common separators from a phone number.
 * Returns null when the input is empty or not a valid number or dialplan pattern.
 * Asterisk dialplan patterns (starting with "_") are only stripped of whitespace.
 */
export function normalizePhoneNumber(value: string | null | undefined): string | null {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) {
    return null;
  }

  if (trimmed.startsWith('_')) {
    const pattern = trimmed.replace(/\s+/g, '');
    return DIALPLAN_PATTERN.test(pattern) ? pattern : null;
  }

  const stripped = trimmed.replace(SEPARATORS, '');
  return E164_PATTERN.test(stripped) ? stripped : null;
}

export function isValidPhoneNumber(value: string | null | undefined): boolean {
  return normalizePhoneNumber(value) !== null;
}

/**
 * Normalizes a SIP user part. Phone-like values lose their separators,
 * other values (for example alphanumeric usernames) only lose whitespace.
 */
export function normalizeSipUser(value: string | null | undefined): string | null {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) {
    return null;
  }
  const compact = PHONE_LIKE.test(trimmed) ? trimmed.replace(SEPARATORS, '') : trimmed.replace(/\s+/g, '');
  return compact || null;
}
