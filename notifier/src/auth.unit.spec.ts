import { tokenMatches } from './auth';

describe('tokenMatches', () => {
  it('accepts the exact token', () => {
    expect(tokenMatches('secret', 'secret')).toBe(true);
  });

  it('rejects a wrong, empty or missing token', () => {
    expect(tokenMatches('secreT', 'secret')).toBe(false);
    expect(tokenMatches('secret-and-more', 'secret')).toBe(false);
    expect(tokenMatches('', 'secret')).toBe(false);
    expect(tokenMatches(undefined, 'secret')).toBe(false);
  });

  it('rejects everything when no token is configured', () => {
    expect(tokenMatches('', '')).toBe(false);
    expect(tokenMatches('anything', '')).toBe(false);
  });
});
