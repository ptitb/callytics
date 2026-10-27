#!/usr/bin/env bash
# Copies the Caddy certificate and key for the SIP hostname to a directory the
# Callytics asterisk container can read.
#
# Why: Caddy keeps its key readable for its own user only (root or caddy). When
# Docker runs rootless or as another user (for example "callytics"), the
# container cannot read Caddy's storage. This script runs as root on the host,
# copies both files with the right owner and only replaces them when they
# changed. The watch loop in the asterisk container then reloads res_pjsip.
#
# Install (as root):
#   install -m 0755 callytics-tls-sync.sh /usr/local/sbin/callytics-tls-sync
#   install -m 0644 callytics-tls-sync.service callytics-tls-sync.timer /etc/systemd/system/
#   edit the Environment= lines in /etc/systemd/system/callytics-tls-sync.service
#   systemctl daemon-reload
#   systemctl enable --now callytics-tls-sync.timer
#   systemctl start callytics-tls-sync.service
#
# Settings (environment variables, set them in the .service file):
#   SIP_TLS_HOSTNAME  hostname of the certificate, for example sip.example.com (required)
#   CADDY_CERT_DIR    Caddy directory that holds <hostname>.crt and <hostname>.key
#                     default: /root/.local/share/caddy/certificates/acme-v02.api.letsencrypt.org-directory/<hostname>
#   TARGET_DIR        destination, use this as SIP_TLS_CERT_DIR in .env (default: /etc/callytics/tls)
#   TARGET_OWNER      user that runs Docker or the container (default: callytics)
#   TARGET_GROUP      group of the copied files (default: same as TARGET_OWNER)

set -euo pipefail

: "${SIP_TLS_HOSTNAME:?SIP_TLS_HOSTNAME is not set}"
CADDY_CERT_DIR="${CADDY_CERT_DIR:-/root/.local/share/caddy/certificates/acme-v02.api.letsencrypt.org-directory/${SIP_TLS_HOSTNAME}}"
TARGET_DIR="${TARGET_DIR:-/etc/callytics/tls}"
TARGET_OWNER="${TARGET_OWNER:-callytics}"
TARGET_GROUP="${TARGET_GROUP:-${TARGET_OWNER}}"

source_cert="${CADDY_CERT_DIR}/${SIP_TLS_HOSTNAME}.crt"
source_key="${CADDY_CERT_DIR}/${SIP_TLS_HOSTNAME}.key"
target_cert="${TARGET_DIR}/${SIP_TLS_HOSTNAME}.crt"
target_key="${TARGET_DIR}/${SIP_TLS_HOSTNAME}.key"

log() {
  echo "[callytics-tls-sync] $*"
}

if [ ! -r "${source_cert}" ] || [ ! -r "${source_key}" ]; then
  log "certificate or key not found in ${CADDY_CERT_DIR}, nothing copied"
  exit 1
fi

# Never publish a pair that does not belong together (Caddy may be halfway a renewal).
cert_public_key="$(openssl x509 -in "${source_cert}" -pubkey -noout)"
key_public_key="$(openssl pkey -in "${source_key}" -pubout)"
if [ "${cert_public_key}" != "${key_public_key}" ]; then
  log "key does not match certificate in ${CADDY_CERT_DIR}, nothing copied"
  exit 1
fi

if cmp -s "${source_cert}" "${target_cert}" && cmp -s "${source_key}" "${target_key}"; then
  exit 0
fi

install -d -o root -g "${TARGET_GROUP}" -m 0750 "${TARGET_DIR}"

# Write to temporary files in the same directory, then rename, so the container
# never reads a half-written file.
install -o "${TARGET_OWNER}" -g "${TARGET_GROUP}" -m 0644 "${source_cert}" "${target_cert}.tmp"
install -o "${TARGET_OWNER}" -g "${TARGET_GROUP}" -m 0640 "${source_key}" "${target_key}.tmp"
mv -f "${target_key}.tmp" "${target_key}"
mv -f "${target_cert}.tmp" "${target_cert}"

log "copied certificate for ${SIP_TLS_HOSTNAME} to ${TARGET_DIR}"
