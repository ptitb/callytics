import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { getSipTlsStatus } from './sip-tls';

describe('getSipTlsStatus', () => {
  const originalEnv = { ...process.env };
  let configDir: string;

  beforeEach(async () => {
    configDir = await fs.mkdtemp(join(tmpdir(), 'sip-tls-'));
    process.env.ASTERISK_CONFIG_DIR = configDir;
    process.env.SIP_TLS_HOSTNAME = 'sip.example.com';
    process.env.SIP_TLS_PORT = '5081';
  });

  afterEach(async () => {
    process.env = { ...originalEnv };
    await fs.rm(configDir, { recursive: true, force: true });
  });

  it('is enabled when the container rendered a transport-tls section', async () => {
    await fs.writeFile(join(configDir, 'pjsip_tls.conf'), '[transport-tls]\ntype = transport\n');

    await expect(getSipTlsStatus()).resolves.toEqual({ enabled: true, hostname: 'sip.example.com', port: 5081 });
  });

  it('is disabled when the container only rendered the disabled marker', async () => {
    await fs.writeFile(join(configDir, 'pjsip_tls.conf'), '; SIP TLS disabled\n');

    await expect(getSipTlsStatus()).resolves.toMatchObject({ enabled: false });
  });

  it('is disabled when the file does not exist', async () => {
    await expect(getSipTlsStatus()).resolves.toMatchObject({ enabled: false });
  });

  it('is disabled without a hostname even when the transport exists', async () => {
    process.env.SIP_TLS_HOSTNAME = '';
    await fs.writeFile(join(configDir, 'pjsip_tls.conf'), '[transport-tls]\n');

    await expect(getSipTlsStatus()).resolves.toMatchObject({ enabled: false, hostname: null });
  });
});
