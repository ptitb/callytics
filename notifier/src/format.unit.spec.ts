import { toFileNamePart, toReadableNumber } from './phone';
import { formatDateTime, formatDuration, formatFileStamp } from './time';

describe('phone number formatting', () => {
  it.each([
    ['31612345678', '0612345678'],
    ['+31612345678', '0612345678'],
    ['0031612345678', '0612345678'],
    ['+31 (0)20 123 4567'.replace('(0)', ''), '0201234567'],
    ['0612345678', '0612345678'],
    ['+4915112345678', '+4915112345678'],
    ['anonymous', 'anonymous'],
  ])('shows %s as %s', (raw, expected) => {
    expect(toReadableNumber(raw)).toBe(expected);
  });

  it('builds a safe file name part', () => {
    expect(toFileNamePart('+31612345678')).toBe('0612345678');
    expect(toFileNamePart('../../x')).toBe('x');
    expect(toFileNamePart('')).toBe('unknown');
  });
});

describe('time formatting', () => {
  const winter = new Date('2026-11-03T09:01:05Z');
  const summer = new Date('2026-07-03T09:01:05Z');

  it('uses dd-mm-yyyy HH:mm:ss in the configured zone', () => {
    expect(formatDateTime(winter, 'Europe/Amsterdam')).toBe('03-11-2026 10:01:05');
    expect(formatDateTime(summer, 'Europe/Amsterdam')).toBe('03-07-2026 11:01:05');
    expect(formatDateTime(winter, 'UTC')).toBe('03-11-2026 09:01:05');
  });

  it('shows midnight as 00 and not 24', () => {
    expect(formatDateTime(new Date('2026-11-03T23:00:00Z'), 'Europe/Amsterdam')).toBe('04-11-2026 00:00:00');
  });

  it('builds the file stamp', () => {
    expect(formatFileStamp(winter, 'Europe/Amsterdam')).toBe('2026-11-03-1001');
  });

  it('formats durations', () => {
    expect(formatDuration(18)).toBe('18 s');
    expect(formatDuration(65)).toBe('1 min 05 s');
  });
});
