import { asteriskTransportName, normalizeTransportType } from './extension-transport';

describe('extension transport helpers', () => {
  it('maps every transport type to its Asterisk transport section', () => {
    expect(asteriskTransportName('sip')).toBe('transport-udp');
    expect(asteriskTransportName('webrtc')).toBe('transport-ws');
    expect(asteriskTransportName('tls')).toBe('transport-tls');
  });

  it('falls back to sip for unknown or missing values', () => {
    expect(normalizeTransportType('tls')).toBe('tls');
    expect(normalizeTransportType('webrtc')).toBe('webrtc');
    expect(normalizeTransportType('bogus')).toBe('sip');
    expect(normalizeTransportType(null)).toBe('sip');
  });
});
