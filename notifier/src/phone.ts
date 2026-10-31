/**
 * Dutch numbers arrive in international form (31612345678 or +31612345678).
 * They are shown in national form (0612345678). Other numbers are shown as received.
 * Returns the national or cleaned form only; callers keep the original value themselves.
 */
export function toReadableNumber(raw: string): string {
  const compact = raw.replace(/[\s().-]/g, '');
  const dutch = /^(?:\+|00)?31(\d{9})$/.exec(compact);
  if (dutch) return `0${dutch[1]}`;
  return compact;
}

/** Characters that are safe in a file name. */
export function toFileNamePart(raw: string): string {
  const cleaned = toReadableNumber(raw).replace(/[^0-9a-zA-Z]/g, '');
  return cleaned || 'unknown';
}
