import { NotifierConfig } from './config';

export function testConfig(overrides: Partial<NotifierConfig> = {}): NotifierConfig {
  return {
    bindAddr: '127.0.0.1',
    port: 3005,
    token: 'secret-token',
    backendUrl: 'http://127.0.0.1:3001',
    smtp: { host: 'smtp.example.com', port: 587, secure: false, user: 'user', pass: 'pass' },
    from: 'callytics@example.com',
    to: ['info@example.com'],
    language: 'nl',
    timezone: 'Europe/Amsterdam',
    problems: [],
    ...overrides,
  };
}
