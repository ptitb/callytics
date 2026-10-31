import { assertBackendRecordingUrl } from './recordingUrl';

const backend = 'http://127.0.0.1:3001';

describe('assertBackendRecordingUrl', () => {
  it('accepts the backend download URL', () => {
    const url = assertBackendRecordingUrl('http://127.0.0.1:3001/recordings/42/download', backend);
    expect(url.pathname).toBe('/recordings/42/download');
  });

  it.each([
    ['another host', 'http://169.254.169.254/recordings/42/download'],
    ['another port', 'http://127.0.0.1:9999/recordings/42/download'],
    ['another scheme', 'https://127.0.0.1:3001/recordings/42/download'],
    ['userinfo host trick', 'http://127.0.0.1:3001@evil.example.com/recordings/42/download'],
    ['another path', 'http://127.0.0.1:3001/health'],
    ['non numeric id', 'http://127.0.0.1:3001/recordings/abc/download'],
    ['path traversal', 'http://127.0.0.1:3001/recordings/42/download/../../x'],
    ['query string', 'http://127.0.0.1:3001/recordings/42/download?x=1'],
    ['credentials', 'http://user:pw@127.0.0.1:3001/recordings/42/download'],
    ['not a URL', 'not a url'],
  ])('refuses %s', (_label, raw) => {
    expect(() => assertBackendRecordingUrl(raw, backend)).toThrow(expect.objectContaining({ status: 400 }));
  });

  it('honours a path prefix in BACKEND_URL', () => {
    expect(() =>
      assertBackendRecordingUrl('http://backend.local/api/recordings/1/download', 'http://backend.local/api'),
    ).not.toThrow();
    expect(() =>
      assertBackendRecordingUrl('http://backend.local/recordings/1/download', 'http://backend.local/api'),
    ).toThrow();
  });
});
