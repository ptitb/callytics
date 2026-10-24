import { promises as fs } from 'fs';
import { join } from 'path';

export interface SipTlsStatus {
  enabled: boolean;
  hostname: string | null;
  port: number;
}

/**
 * SIP TLS is enabled when the asterisk container rendered a transport-tls
 * section (it does so only when a readable certificate and key exist) and a
 * hostname is configured for the provisioning URI.
 */
export async function getSipTlsStatus(): Promise<SipTlsStatus> {
  const hostname = process.env.SIP_TLS_HOSTNAME?.trim() || null;
  const port = Number(process.env.SIP_TLS_PORT || 5081);
  const configDir = process.env.ASTERISK_CONFIG_DIR || '/etc/asterisk';
  try {
    const content = await fs.readFile(join(configDir, 'pjsip_tls.conf'), 'utf8');
    return { enabled: Boolean(hostname) && content.includes('[transport-tls]'), hostname, port };
  } catch {
    return { enabled: false, hostname, port };
  }
}
