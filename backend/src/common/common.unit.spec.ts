import { isValidIpMatch, normalizeIpMatchList } from './ip-match';
import { normalizePhoneNumber, normalizeSipUser } from './phone-number';
import { getUploadMaxBytes } from './upload-limit';

describe('normalizePhoneNumber', () => {
  it.each([
    ['+31 970 000 0000', '+319700000000'],
    ['+31-970-000-0000', '+319700000000'],
    ['(020) 123 4567', '0201234567'],
    ['1001', '1001'],
    ['_X.', '_X.'],
  ])('normalizes %s', (input, expected) => {
    expect(normalizePhoneNumber(input)).toBe(expected);
  });

  it.each(['', '   ', 'abc', '+31 abc', '+1234567890123456', null, undefined])('rejects %p', (input) => {
    expect(normalizePhoneNumber(input as string | null | undefined)).toBeNull();
  });
});

describe('normalizeSipUser', () => {
  it('strips separators from phone-like values', () => {
    expect(normalizeSipUser(' +31 970 000 0000 ')).toBe('+319700000000');
  });

  it('keeps alphanumeric users', () => {
    expect(normalizeSipUser('acme-user')).toBe('acme-user');
  });

  it('returns null for empty input', () => {
    expect(normalizeSipUser('  ')).toBeNull();
  });
});

describe('IP match validation', () => {
  it.each(['192.0.2.1', '198.51.100.0/24', '0.0.0.0/0'])('accepts %s', (value) => {
    expect(isValidIpMatch(value)).toBe(true);
  });

  it.each(['192.0.2.256', '192.0.2.1/33', '192.0.2', 'example.com', '192.0.2.1/', '::1', '192.0.2.1/24/8'])(
    'rejects %s',
    (value) => {
      expect(isValidIpMatch(value)).toBe(false);
    },
  );

  it('trims, removes duplicates and empty entries', () => {
    expect(normalizeIpMatchList([' 192.0.2.1 ', '', '192.0.2.1', '198.51.100.0/24'])).toEqual([
      '192.0.2.1',
      '198.51.100.0/24',
    ]);
  });

  it('lists every invalid entry in the error', () => {
    expect(() => normalizeIpMatchList(['192.0.2.1', 'bad', '1.2.3.4/99'])).toThrow('bad, 1.2.3.4/99');
  });

  it('returns an empty list for undefined', () => {
    expect(normalizeIpMatchList(undefined)).toEqual([]);
  });
});

describe('getUploadMaxBytes', () => {
  it('defaults to 100 MB', () => {
    expect(getUploadMaxBytes({} as NodeJS.ProcessEnv)).toBe(100 * 1024 * 1024);
  });

  it('reads UPLOAD_MAX_MB', () => {
    expect(getUploadMaxBytes({ UPLOAD_MAX_MB: '25' } as NodeJS.ProcessEnv)).toBe(25 * 1024 * 1024);
  });

  it('ignores invalid values', () => {
    expect(getUploadMaxBytes({ UPLOAD_MAX_MB: 'abc' } as NodeJS.ProcessEnv)).toBe(100 * 1024 * 1024);
    expect(getUploadMaxBytes({ UPLOAD_MAX_MB: '-5' } as NodeJS.ProcessEnv)).toBe(100 * 1024 * 1024);
  });
});
