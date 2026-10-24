#!/usr/bin/env bash
# CALLYTICS INSTALL SCRIPT
# Run this instead of 'docker compose up' to get the full setup experience.
# Usage: bash scripts/install.sh [--vpn|--no-vpn] [--yes]
#
# The script creates .env from .env.example when it does not exist, generates
# the secrets, asks for the installation settings and then starts the stack.
# Secrets that are already filled in .env are never overwritten. Settings that
# are already in .env are proposed as the default answer.
# --yes accepts the proposed value for every question.

set -euo pipefail

ENV_FILE=".env"
ENV_EXAMPLE=".env.example"
enable_vpn=""
assume_yes="no"

for arg in "$@"; do
  case "$arg" in
    --vpn)
      enable_vpn="yes"
      ;;
    --no-vpn)
      enable_vpn="no"
      ;;
    --yes|-y)
      assume_yes="yes"
      ;;
    *)
      printf 'Unknown option: %s\n' "$arg" >&2
      exit 1
      ;;
  esac
done

get_env() {
  # Prints the value of KEY in .env, empty when missing.
  local key="$1"
  grep -E "^${key}=" "$ENV_FILE" 2>/dev/null | tail -n 1 | cut -d= -f2- || true
}

set_env() {
  # Sets KEY=VALUE in .env, replacing an existing line or appending a new one.
  local key="$1" value="$2" tmp
  tmp="$(mktemp)"
  if grep -qE "^${key}=" "$ENV_FILE"; then
    awk -v key="$key" -v value="$value" 'BEGIN { FS = OFS = "=" } $1 == key { print key "=" value; next } { print }' "$ENV_FILE" > "$tmp"
  else
    cat "$ENV_FILE" > "$tmp"
    printf '%s=%s\n' "$key" "$value" >> "$tmp"
  fi
  cat "$tmp" > "$ENV_FILE"
  rm -f "$tmp"
}

generate_secret() {
  openssl rand -hex 24
}

ensure_secret() {
  # Generates a random value for KEY unless one is already set.
  local key="$1"
  if [[ -z "$(get_env "$key")" ]]; then
    set_env "$key" "$(generate_secret)"
    printf 'Generated %s\n' "$key"
  fi
}

detect_host_ip() {
  local ip=""
  if command -v ip >/dev/null 2>&1; then
    ip="$(ip route get 1 2>/dev/null | awk '{for (i = 1; i <= NF; i++) if ($i == "src") { print $(i + 1); exit }}')"
  fi
  printf '%s' "$ip"
}

ask_setting() {
  # ask_setting KEY "Question" "fallback default"
  # The proposed value is the one already in .env, otherwise the fallback.
  # --yes accepts the proposed value without asking.
  local key="$1" question="$2" fallback="$3" proposed answer
  proposed="$(get_env "$key")"
  if [[ -z "$proposed" || ( "$key" == "HOST_IP" && "$proposed" == "127.0.0.1" ) ]]; then
    proposed="$fallback"
  fi
  if [[ "$assume_yes" == "yes" ]]; then
    answer="$proposed"
  else
    printf '%s [%s]: ' "$question" "$proposed"
    read -r answer
    answer="${answer:-$proposed}"
  fi
  set_env "$key" "$answer"
}

if [[ ! -f "$ENV_FILE" ]]; then
  cp "$ENV_EXAMPLE" "$ENV_FILE"
  printf 'Created %s from %s\n' "$ENV_FILE" "$ENV_EXAMPLE"
fi

ensure_secret DB_PASS
ensure_secret ARI_PASS
ensure_secret AMI_PASS
ensure_secret RECORDINGS_INTERNAL_TOKEN
# Aliases read by some backend services and by the test harness.
set_env POSTGRES_PASSWORD "$(get_env DB_PASS)"
set_env ARI_PASSWORD "$(get_env ARI_PASS)"
set_env AMI_PASSWORD "$(get_env AMI_PASS)"

ask_setting HOST_IP "Public IP address of this server (used in SIP provisioning and VPN)" "$(detect_host_ip)"
if [[ -z "$(get_env HOST_IP)" ]]; then
  printf 'HOST_IP is required. Set it in %s and run this script again.\n' "$ENV_FILE" >&2
  exit 1
fi
ask_setting SIP_PORT "SIP port (use another port when this host already runs a PBX on 5060/5080)" "5080"
ask_setting AMI_PORT "Asterisk AMI port (FreePBX on the same host uses 5038)" "5038"
ask_setting RTP_PORT_START "First RTP port (FreePBX uses 10000-20000)" "10000"
ask_setting RTP_PORT_END "Last RTP port" "20000"
ask_setting WEB_BIND_ADDR "Web UI bind address (127.0.0.1 = only via a reverse proxy on this host, 0.0.0.0 = all interfaces, no authentication!)" "127.0.0.1"
ask_setting UPLOAD_MAX_MB "Maximum upload size in MB" "100"

if [[ -z "$enable_vpn" ]]; then
  if [[ "$assume_yes" == "yes" ]]; then
    enable_vpn="no"
  else
    printf 'Enable built-in WireGuard VPN?\n'
    printf 'Allows remote softphones to connect without port forwarding.\n'
    printf 'Requires UDP port 51820 forwarded on your router.\n'
    printf '[y/N]: '
    read -r answer
    case "$answer" in
      y|Y|yes|YES)
        enable_vpn="yes"
        ;;
      *)
        enable_vpn="no"
        ;;
    esac
  fi
fi

mkdir -p wireguard-config

if [[ "$enable_vpn" == "yes" ]]; then
  docker compose --profile vpn up -d
else
  docker compose up -d
fi
