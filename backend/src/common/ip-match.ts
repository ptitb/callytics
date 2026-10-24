const IPV4_PATTERN = /^(25[0-5]|2[0-4]\d|1?\d{1,2})(\.(25[0-5]|2[0-4]\d|1?\d{1,2})){3}$/;

/** Returns true for a plain IPv4 address or an IPv4 CIDR range (prefix 0-32). */
export function isValidIpMatch(value: string): boolean {
  const [address, prefix, ...rest] = value.split('/');
  if (rest.length > 0 || !IPV4_PATTERN.test(address)) {
    return false;
  }
  if (prefix === undefined) {
    return true;
  }
  return /^\d{1,2}$/.test(prefix) && Number(prefix) <= 32;
}

/**
 * Cleans a list of inbound IP matches: trims, drops empty items and duplicates.
 * Throws an Error listing every invalid entry.
 */
export function normalizeIpMatchList(values: readonly string[] | null | undefined): string[] {
  const unique: string[] = [];
  const invalid: string[] = [];
  for (const raw of values ?? []) {
    const value = String(raw).trim();
    if (!value) {
      continue;
    }
    if (!isValidIpMatch(value)) {
      invalid.push(value);
      continue;
    }
    if (!unique.includes(value)) {
      unique.push(value);
    }
  }
  if (invalid.length > 0) {
    throw new Error(`Invalid IPv4 address or CIDR range: ${invalid.join(', ')}`);
  }
  return unique;
}
