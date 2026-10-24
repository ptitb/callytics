const SEPARATORS = /[\s\-.()/]/g;
const E164_PATTERN = /^\+?\d{1,15}$/;
const DIALPLAN_PATTERN = /^_[0-9XZN[\]\-.!+#*]+$/;
const IPV4_PATTERN = /^(25[0-5]|2[0-4]\d|1?\d{1,2})(\.(25[0-5]|2[0-4]\d|1?\d{1,2})){3}$/;

/** Strips spaces and separators. Returns null for empty or invalid input. Mirrors the backend rule. */
export function normalizePhoneNumber(value: string): string | null {
  const trimmed = value.trim();
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

export function isValidIpMatch(value: string): boolean {
  const [address, prefix, ...rest] = value.trim().split('/');
  if (rest.length > 0 || !IPV4_PATTERN.test(address)) {
    return false;
  }
  if (prefix === undefined) {
    return true;
  }
  return /^\d{1,2}$/.test(prefix) && Number(prefix) <= 32;
}

/** Splits free text (newline, comma or whitespace separated) into a unique list of entries. */
export function parseIpMatchInput(text: string): string[] {
  const entries = text.split(/[\s,;]+/).map((item) => item.trim()).filter(Boolean);
  return entries.filter((item, index) => entries.indexOf(item) === index);
}

/** Returns the entries that are neither an IPv4 address nor an IPv4 CIDR range. */
export function findInvalidIpMatches(entries: string[]): string[] {
  return entries.filter((entry) => !isValidIpMatch(entry));
}
