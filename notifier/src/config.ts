export type Language = 'nl' | 'en';

export interface SmtpSettings {
  host: string;
  port: number;
  secure: boolean;
  user?: string;
  pass?: string;
}

export interface NotifierConfig {
  bindAddr: string;
  port: number;
  /** Shared secret expected in the X-Callytics-Token header. Empty when not configured. */
  token: string;
  /** BACKEND_URL without trailing slash. Recordings are only downloaded from here. */
  backendUrl: string;
  smtp: SmtpSettings;
  from: string;
  to: string[];
  language: Language;
  timezone: string;
  /** Human readable reasons why webhooks cannot be handled yet. Empty means ready. */
  problems: string[];
}

export class ConfigError extends Error {}

type Env = Record<string, string | undefined>;

const EMAIL_PATTERN = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/;

function read(env: Env, key: string, fallback = ''): string {
  const value = env[key];
  return value === undefined || value.trim() === '' ? fallback : value.trim();
}

function parsePort(value: string, key: string): number {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new ConfigError(`${key} must be a port number between 1 and 65535, got "${value}"`);
  }
  return port;
}

function parseBoolean(value: string, key: string): boolean {
  const normalized = value.toLowerCase();
  if (['true', '1', 'yes'].includes(normalized)) return true;
  if (['false', '0', 'no', ''].includes(normalized)) return false;
  throw new ConfigError(`${key} must be true or false, got "${value}"`);
}

function parseTimezone(value: string): string {
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: value });
  } catch {
    throw new ConfigError(`NOTIFY_TIMEZONE is not a valid IANA time zone: "${value}"`);
  }
  return value;
}

function parseBackendUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new ConfigError(`BACKEND_URL is not a valid URL: "${value}"`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new ConfigError('BACKEND_URL must use http or https');
  }
  return value.replace(/\/+$/, '');
}

/**
 * Reads the notifier settings from the environment.
 * Malformed values throw a ConfigError (the container then stops with a clear message).
 * Missing optional-by-design values (SMTP, token) do not throw: they are listed in
 * `problems` so the service can start and answer 503 instead of breaking `docker compose up`.
 */
export function loadConfig(env: Env): NotifierConfig {
  const language = read(env, 'NOTIFY_LANGUAGE', 'nl').toLowerCase();
  if (language !== 'nl' && language !== 'en') {
    throw new ConfigError(`NOTIFY_LANGUAGE must be nl or en, got "${language}"`);
  }

  const to = read(env, 'NOTIFY_TO')
    .split(',')
    .map((address) => address.trim())
    .filter(Boolean);
  const invalidAddress = to.find((address) => !EMAIL_PATTERN.test(address));
  if (invalidAddress) {
    throw new ConfigError(`NOTIFY_TO contains an invalid e-mail address: "${invalidAddress}"`);
  }

  const config: NotifierConfig = {
    bindAddr: read(env, 'NOTIFIER_BIND_ADDR', '127.0.0.1'),
    port: parsePort(read(env, 'NOTIFIER_PORT', '3005'), 'NOTIFIER_PORT'),
    token: read(env, 'NOTIFIER_TOKEN'),
    backendUrl: parseBackendUrl(read(env, 'BACKEND_URL', 'http://127.0.0.1:3001')),
    smtp: {
      host: read(env, 'SMTP_HOST'),
      port: parsePort(read(env, 'SMTP_PORT', '587'), 'SMTP_PORT'),
      secure: parseBoolean(read(env, 'SMTP_SECURE', 'false'), 'SMTP_SECURE'),
      user: read(env, 'SMTP_USER') || undefined,
      pass: env.SMTP_PASS === undefined || env.SMTP_PASS === '' ? undefined : env.SMTP_PASS,
    },
    from: read(env, 'NOTIFY_FROM'),
    to,
    language,
    timezone: parseTimezone(read(env, 'NOTIFY_TIMEZONE', 'Europe/Amsterdam')),
    problems: [],
  };

  if (!config.token) config.problems.push('NOTIFIER_TOKEN is not set');
  if (!config.smtp.host) config.problems.push('SMTP_HOST is not set');
  if (!config.from) config.problems.push('NOTIFY_FROM is not set');
  if (config.to.length === 0) config.problems.push('NOTIFY_TO is not set');
  if (Boolean(config.smtp.user) !== Boolean(config.smtp.pass)) {
    config.problems.push('SMTP_USER and SMTP_PASS must be set together');
  }

  return config;
}
