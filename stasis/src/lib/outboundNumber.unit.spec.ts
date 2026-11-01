import {
  extractDialedNumber,
  isOutboundNumberAllowed,
  DEFAULT_OUTBOUND_NUMBER_SETTINGS,
  normalizeOutboundNumber,
  parseOutboundNumberSettings,
} from './outboundNumber';

const defaults = DEFAULT_OUTBOUND_NUMBER_SETTINGS;

describe('normalizeOutboundNumber', () => {
  it.each([
    ['0612345678', '+31612345678'],
    ['0201234567', '+31201234567'],
    ['0031612345678', '+31612345678'],
    ['00442071234567', '+442071234567'],
    ['+442071234567', '+442071234567'],
    ['+31612345678', '+31612345678'],
    ['112', '112'],
    ['1233', '1233'],
    ['0', '0'],
    ['00', '00'],
  ])('converts %s to %s', (input, expected) => {
    expect(normalizeOutboundNumber(input, defaults)).toBe(expected);
  });

  it('strips spaces, dashes, dots and parentheses', () => {
    expect(normalizeOutboundNumber('06 12-34.56 78', defaults)).toBe('+31612345678');
    expect(normalizeOutboundNumber('(020) 123 4567', defaults)).toBe('+31201234567');
    expect(normalizeOutboundNumber('+44 (0) 20 7123 4567', defaults)).toBe('+4402071234567');
    expect(normalizeOutboundNumber('00 44 20 7123 4567', defaults)).toBe('+442071234567');
  });

  it('leaves the number untouched when conversion is off', () => {
    const off = { ...defaults, normalizeE164: false };
    expect(normalizeOutboundNumber('0612345678', off)).toBe('0612345678');
    expect(normalizeOutboundNumber('0031612345678', off)).toBe('0031612345678');
    expect(normalizeOutboundNumber('06 12', off)).toBe('06 12');
  });

  it('uses a custom country code', () => {
    const settings = { ...defaults, countryCode: '44' };
    expect(normalizeOutboundNumber('02071234567', settings)).toBe('+442071234567');
  });

  it('uses a custom international prefix', () => {
    const settings = { ...defaults, internationalPrefix: '011' };
    expect(normalizeOutboundNumber('011442071234567', settings)).toBe('+442071234567');
    // 00 is no longer the international prefix, so it is treated as a national number
    expect(normalizeOutboundNumber('0031612345678', settings)).toBe('+31031612345678');
  });

  it('does not touch values with other characters', () => {
    expect(normalizeOutboundNumber('06abc', defaults)).toBe('06abc');
  });
});

describe('parseOutboundNumberSettings', () => {
  it('reads valid values', () => {
    expect(parseOutboundNumberSettings({
      outbound_normalize_e164: false,
      outbound_country_code: '44',
      outbound_international_prefix: '011',
    })).toEqual({
      ...defaults,
      normalizeE164: false,
      countryCode: '44',
      internationalPrefix: '011',
    });
  });

  it('reads the short number settings', () => {
    expect(parseOutboundNumberSettings({
      outbound_min_number_length: 6,
      outbound_allowed_short_numbers: '112, 911,abc,',
    })).toMatchObject({ minLength: 6, allowedShortNumbers: ['112', '911'] });
    expect(parseOutboundNumberSettings({ outbound_allowed_short_numbers: '' }).allowedShortNumbers).toEqual([]);
  });

  it('ignores invalid short number settings', () => {
    expect(parseOutboundNumberSettings({
      outbound_min_number_length: '6',
      outbound_allowed_short_numbers: 112,
    })).toMatchObject({ minLength: 0, allowedShortNumbers: ['112'] });
    expect(parseOutboundNumberSettings({ outbound_min_number_length: -1 }).minLength).toBe(0);
    expect(parseOutboundNumberSettings({ outbound_min_number_length: 2.5 }).minLength).toBe(0);
  });

  it('falls back to the defaults for missing or invalid values', () => {
    expect(parseOutboundNumberSettings(undefined)).toEqual(defaults);
    expect(parseOutboundNumberSettings({
      outbound_normalize_e164: 'false',
      outbound_country_code: '+31',
      outbound_international_prefix: 'abc',
    })).toEqual(defaults);
  });
});

describe('isOutboundNumberAllowed', () => {
  const strict = { ...defaults, minLength: 6, allowedShortNumbers: ['112', '1234'] };

  it('allows everything when the minimum length is 0', () => {
    expect(isOutboundNumberAllowed('1', defaults)).toBe(true);
    expect(isOutboundNumberAllowed('0', defaults)).toBe(true);
  });

  it('blocks numbers shorter than the minimum length', () => {
    expect(isOutboundNumberAllowed('201', strict)).toBe(false);
    expect(isOutboundNumberAllowed('12345', strict)).toBe(false);
  });

  it('allows numbers of at least the minimum length', () => {
    expect(isOutboundNumberAllowed('123456', strict)).toBe(true);
    expect(isOutboundNumberAllowed('0612345678', strict)).toBe(true);
    expect(isOutboundNumberAllowed('+442071234567', strict)).toBe(true);
  });

  it('allows the listed short numbers', () => {
    expect(isOutboundNumberAllowed('112', strict)).toBe(true);
    expect(isOutboundNumberAllowed('1234', strict)).toBe(true);
    expect(isOutboundNumberAllowed('113', strict)).toBe(false);
  });

  it('counts digits only', () => {
    expect(isOutboundNumberAllowed('+1 13', strict)).toBe(false);
  });
});

describe('extractDialedNumber', () => {
  it('removes the # prefix', () => {
    expect(extractDialedNumber('#0612345678')).toBe('0612345678');
    expect(extractDialedNumber('#+442071234567')).toBe('+442071234567');
  });

  it('rejects anything that is not a number', () => {
    expect(extractDialedNumber('#')).toBeNull();
    expect(extractDialedNumber('#06abc')).toBeNull();
    expect(extractDialedNumber('#06 12')).toBeNull();
    expect(extractDialedNumber('#4+4')).toBeNull();
  });
});

describe('direct outbound destination', () => {
  const destinationFor = (exten: string, settings = defaults) => {
    const dialed = extractDialedNumber(exten);
    return dialed === null ? null : normalizeOutboundNumber(dialed, settings);
  };

  it('uses the normalised number for both # and no-# dialing', () => {
    expect(destinationFor('#0612345678')).toBe('+31612345678');
    expect(destinationFor('#0031612345678')).toBe('+31612345678');
    expect(destinationFor('#+442071234567')).toBe('+442071234567');
  });

  it('passes the number on unchanged when conversion is off', () => {
    expect(destinationFor('#0612345678', { ...defaults, normalizeE164: false })).toBe('0612345678');
  });
});
