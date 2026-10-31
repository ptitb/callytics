import { createHash, timingSafeEqual } from 'crypto';

/**
 * Constant-time comparison of the presented token with the expected one.
 * Both values are hashed first so the comparison also does not leak the token length.
 */
export function tokenMatches(presented: string | undefined, expected: string): boolean {
  if (!expected || !presented) return false;
  const presentedHash = createHash('sha256').update(presented).digest();
  const expectedHash = createHash('sha256').update(expected).digest();
  return timingSafeEqual(presentedHash, expectedHash);
}
