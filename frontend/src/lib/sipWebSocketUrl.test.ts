import { describe, expect, it } from 'vitest';
import { getSipWebSocketUrl } from './sipWebSocketUrl';

describe('getSipWebSocketUrl', () => {
  it('uses wss when the page is served over HTTPS', () => {
    expect(getSipWebSocketUrl({ protocol: 'https:', host: 'callytics.example.com' })).toBe('wss://callytics.example.com/ws');
  });

  it('uses ws when the page is served over HTTP, keeping the port', () => {
    expect(getSipWebSocketUrl({ protocol: 'http:', host: '127.0.0.1:3000' })).toBe('ws://127.0.0.1:3000/ws');
  });
});
