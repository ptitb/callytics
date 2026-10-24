#!/usr/bin/env bash
# Example host firewall (ufw) for a server that runs Callytics, FreePBX, Caddy
# and Headscale. This is an EXAMPLE. Read every line and adapt it.
#
# WARNING: "default deny incoming" locks you out of SSH when the SSH rule is
# missing or wrong. Keep a second session or console access open while you
# apply this, and run "ufw allow" for SSH BEFORE "ufw enable".
#
# This file is not executable on purpose and exits immediately. Remove the
# "exit 1" line below once you have adjusted the values.
exit 1

set -euo pipefail

# Placeholders: replace with real values (documentation addresses used here).
PROVIDER_IPS=("203.0.113.10" "203.0.113.11")  # SIP provider addresses (inbound whitelist)
SIP_PORT=5080                                  # SIP_PORT in .env
SIP_TLS_PORT=5081                              # SIP_TLS_PORT in .env
RTP_START=10100                                # RTP_PORT_START in .env
RTP_END=10120                                  # RTP_PORT_END in .env

# 1. SSH first. Change the port or restrict the source when you can.
ufw allow 22/tcp comment 'ssh'

# 2. Policy.
ufw default deny incoming
ufw default allow outgoing

# 3. Everything arriving over the tailnet interface (Callytics UI via Caddy, SSH, ...).
ufw allow in on tailscale0

# 4. Caddy: ACME challenges and the websites.
ufw allow 80/tcp comment 'caddy http'
ufw allow 443/tcp comment 'caddy https'

# 5. Callytics SIP towards the provider: only the provider addresses.
for ip in "${PROVIDER_IPS[@]}"; do
  ufw allow from "$ip" to any port "$SIP_PORT" proto udp comment 'callytics sip provider'
done

# 6. Callytics SIP TLS for softphones. Open to everyone: push-enabled softphones
#    (Groundwire / Acrobits) register from the vendor's own servers as well.
#    Protection is the strong extension password and mandatory TLS + SRTP.
ufw allow "${SIP_TLS_PORT}"/tcp comment 'callytics sip tls'

# 7. Callytics RTP (audio). Softphones connect from changing addresses, so this is open.
ufw allow "${RTP_START}:${RTP_END}"/udp comment 'callytics rtp'

# 8. Keep the rules FreePBX needs. Uncomment and adapt what you use:
# ufw allow from 203.0.113.10 to any port 5060 proto udp comment 'freepbx sip provider'
# ufw allow 10000:20000/udp comment 'freepbx rtp'
# ufw allow 5061/tcp comment 'freepbx sip tls (later)'

# 9. Headscale on this host: the DERP/STUN server of Headscale needs 3478/udp.
#    The control server itself is served through Caddy on 443.
# ufw allow 3478/udp comment 'headscale derp stun'

# 10. Enable last, after you checked "ufw show added".
# ufw show added
# ufw enable
