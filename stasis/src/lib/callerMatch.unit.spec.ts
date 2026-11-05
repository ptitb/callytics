import { evaluateCallerMatch, normalizeCallerNumber, parseRuleNumbers, type CallerMatchConfig } from './callerMatch';
import { DEFAULT_OUTBOUND_NUMBER_SETTINGS } from './outboundNumber';

const settings = DEFAULT_OUTBOUND_NUMBER_SETTINGS;

describe('normalizeCallerNumber', () => {
  it.each([
    ['0612345678', '+31612345678'],
    ['06 12 34 56 78', '+31612345678'],
    ['06-1234.5678', '+31612345678'],
    ['+31612345678', '+31612345678'],
    ['+31 6 1234 5678', '+31612345678'],
    ['31612345678', '+31612345678'],
    ['0031612345678', '+31612345678'],
    ['020 123 4567', '+31201234567'],
    ['1000', '1000'],
  ])('normalises %s to %s', (raw, expected) => {
    expect(normalizeCallerNumber(raw, settings)).toBe(expected);
  });

  it.each(['', '   ', 'anonymous', 'Anonymous', 'unknown', 'restricted', 'private', 'sip:abc', 'abc123'])(
    'returns null for %p',
    (raw) => {
      expect(normalizeCallerNumber(raw, settings)).toBeNull();
    },
  );

  it('uses the country code of the settings for national numbers', () => {
    expect(normalizeCallerNumber('0201234567', { ...settings, countryCode: '44' })).toBe('+44201234567');
  });

  it('uses the international prefix of the settings', () => {
    expect(normalizeCallerNumber('011442012345678', { ...settings, internationalPrefix: '011' })).toBe('+442012345678');
  });
});

describe('parseRuleNumbers', () => {
  it('splits on commas and newlines and normalises each entry', () => {
    expect(parseRuleNumbers('0612345678, +31611111111\n0031622222222', settings)).toEqual([
      '+31612345678',
      '+31611111111',
      '+31622222222',
    ]);
  });

  it('drops entries that are not numbers', () => {
    expect(parseRuleNumbers('abc,,0612345678', settings)).toEqual(['+31612345678']);
    expect(parseRuleNumbers(undefined, settings)).toEqual([]);
  });
});

describe('evaluateCallerMatch', () => {
  const config: CallerMatchConfig = {
    rules: [
      { branch: 'anonymous', match: 'anonymous' },
      { branch: 'vip', match: 'exact', value: '+31612345678, 0687654321' },
      { branch: 'amsterdam', match: 'prefix', value: '+3120\n+3129' },
      { branch: 'dutch_mobile', match: 'prefix', value: '+316' },
    ],
  };
  const branchFor = (caller: string) => evaluateCallerMatch(config, caller, settings).branch;

  it('matches an exact number in any notation', () => {
    expect(branchFor('0612345678')).toBe('vip');
    expect(branchFor('31612345678')).toBe('vip');
    expect(branchFor('+31 6 12345678')).toBe('vip');
  });

  it('matches any number of an exact list', () => {
    expect(branchFor('+31687654321')).toBe('vip');
  });

  it('does not treat exact as prefix', () => {
    expect(branchFor('+316123456789')).toBe('dutch_mobile');
  });

  it('matches prefixes from a list', () => {
    expect(branchFor('0201234567')).toBe('amsterdam');
    expect(branchFor('+31291234567')).toBe('amsterdam');
  });

  it.each(['', 'anonymous', 'unknown', 'restricted', 'private', 'not-a-number'])(
    'matches the anonymous rule for %p',
    (caller) => {
      expect(branchFor(caller)).toBe('anonymous');
    },
  );

  it('lets the first matching rule win', () => {
    expect(branchFor('+31612345678')).toBe('vip');
    expect(branchFor('+31699999999')).toBe('dutch_mobile');
  });

  it('returns default when no rule matches', () => {
    expect(branchFor('+4915112345678')).toBe('default');
  });

  it('returns default for an anonymous caller without an anonymous rule', () => {
    expect(evaluateCallerMatch({ rules: [{ branch: 'vip', match: 'prefix', value: '+31' }] }, 'anonymous', settings).branch)
      .toBe('default');
  });

  it('returns default without rules', () => {
    expect(evaluateCallerMatch({}, '+31612345678', settings).branch).toBe('default');
  });

  it('reports the normalised caller', () => {
    expect(evaluateCallerMatch(config, '0612345678', settings).normalizedCaller).toBe('+31612345678');
    expect(evaluateCallerMatch(config, 'anonymous', settings).normalizedCaller).toBeNull();
  });
});
