import { describe, expect, it } from 'vitest';
import { findInvalidIpMatches, validateRtpRange, isValidIpMatch, normalizePhoneNumber, parseIpMatchInput } from './validation';

describe('normalizePhoneNumber', () => {
  it('removes spaces and separators', () => {
    expect(normalizePhoneNumber('+31 970 1234 5678')).toBe('+3197012345678');
  });

  it('rejects letters', () => {
    expect(normalizePhoneNumber('+31abc')).toBeNull();
  });

  it('rejects empty input', () => {
    expect(normalizePhoneNumber('  ')).toBeNull();
  });

  it('keeps dialplan patterns', () => {
    expect(normalizePhoneNumber('_X.')).toBe('_X.');
  });
});

describe('IP match validation', () => {
  it('accepts addresses and CIDR ranges', () => {
    expect(isValidIpMatch('192.0.2.10')).toBe(true);
    expect(isValidIpMatch('198.51.100.0/24')).toBe(true);
  });

  it('rejects malformed values', () => {
    expect(findInvalidIpMatches(['192.0.2.256', '192.0.2.1/33', 'example.com', '10.0.0.1'])).toEqual([
      '192.0.2.256',
      '192.0.2.1/33',
      'example.com',
    ]);
  });

  it('parses mixed separators and removes duplicates', () => {
    expect(parseIpMatchInput('192.0.2.1, 192.0.2.2\n192.0.2.1')).toEqual(['192.0.2.1', '192.0.2.2']);
  });
});

describe('validateRtpRange', () => {
  it('accepts a valid range', () => {
    expect(validateRtpRange(10100, 10120)).toBeNull();
  });

  it('rejects an odd start port', () => {
    expect(validateRtpRange(10101, 10200)).toMatch(/even/);
  });

  it('rejects a range that is too small', () => {
    expect(validateRtpRange(10100, 10110)).toMatch(/at least 20/);
  });

  it('rejects ports out of bounds', () => {
    expect(validateRtpRange(100, 5000)).toMatch(/between/);
  });
});
