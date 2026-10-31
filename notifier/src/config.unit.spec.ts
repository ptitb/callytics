import { ConfigError, loadConfig } from './config';

const complete = {
  NOTIFIER_TOKEN: 'abc',
  SMTP_HOST: 'smtp.example.com',
  NOTIFY_FROM: 'callytics@example.com',
  NOTIFY_TO: 'a@example.com, b@example.com',
};

describe('loadConfig', () => {
  it('applies defaults and is ready with the required values', () => {
    const config = loadConfig(complete);
    expect(config).toMatchObject({
      bindAddr: '127.0.0.1',
      port: 3005,
      backendUrl: 'http://127.0.0.1:3001',
      language: 'nl',
      timezone: 'Europe/Amsterdam',
      smtp: { port: 587, secure: false },
      to: ['a@example.com', 'b@example.com'],
    });
    expect(config.problems).toEqual([]);
  });

  it('lists what is missing instead of throwing', () => {
    const config = loadConfig({});
    expect(config.problems).toEqual([
      'NOTIFIER_TOKEN is not set',
      'SMTP_HOST is not set',
      'NOTIFY_FROM is not set',
      'NOTIFY_TO is not set',
    ]);
  });

  it('requires SMTP_USER and SMTP_PASS together', () => {
    const config = loadConfig({ ...complete, SMTP_USER: 'user' });
    expect(config.problems).toContain('SMTP_USER and SMTP_PASS must be set together');
  });

  it('parses SMTP_SECURE and strips a trailing slash from BACKEND_URL', () => {
    const config = loadConfig({ ...complete, SMTP_SECURE: 'true', SMTP_PORT: '465', BACKEND_URL: 'http://127.0.0.1:3001/' });
    expect(config.smtp).toMatchObject({ secure: true, port: 465 });
    expect(config.backendUrl).toBe('http://127.0.0.1:3001');
  });

  it.each([
    [{ NOTIFIER_PORT: 'abc' }, 'NOTIFIER_PORT'],
    [{ SMTP_PORT: '70000' }, 'SMTP_PORT'],
    [{ SMTP_SECURE: 'maybe' }, 'SMTP_SECURE'],
    [{ NOTIFY_LANGUAGE: 'de' }, 'NOTIFY_LANGUAGE'],
    [{ NOTIFY_TIMEZONE: 'Mars/Base' }, 'NOTIFY_TIMEZONE'],
    [{ NOTIFY_TO: 'not-an-address' }, 'NOTIFY_TO'],
    [{ BACKEND_URL: 'ftp://host' }, 'BACKEND_URL'],
  ])('rejects malformed value %j', (override, key) => {
    expect(() => loadConfig({ ...complete, ...override })).toThrow(ConfigError);
    expect(() => loadConfig({ ...complete, ...override })).toThrow(key);
  });

  it('never exposes the SMTP password in a problem message', () => {
    const config = loadConfig({ ...complete, SMTP_USER: 'user', SMTP_PASS: 'hunter2-secret' });
    expect(JSON.stringify(config.problems)).not.toContain('hunter2-secret');
  });
});
