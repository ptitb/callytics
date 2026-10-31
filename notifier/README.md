# Callytics notifier

Small Node.js service that receives Callytics flow webhooks and sends e-mails to one general address:

- **Missed call:** caller number and time.
- **New voicemail:** caller number, time, duration and the recording as MP3 attachment.

Setup, flow configuration and troubleshooting: see "E-mailmeldingen" in `INSTALL.md` (Dutch) and `docs-site/features/email-notifications.md` (English).

## Endpoints

| Method and path | Auth | Purpose |
| --- | --- | --- |
| `GET /health` | none | Liveness. `{"status":"ok","ready":true}`. `ready` is false while settings are missing. |
| `POST /webhooks/missed-call` | `X-Callytics-Token` | Mail a missed call. |
| `POST /webhooks/voicemail` | `X-Callytics-Token` | Download the recording, convert to MP3, mail it. |

The two webhook paths are separate on purpose, so the service never has to guess from `node_type` what a payload means. The body is the standard Callytics webhook payload (`stasis/src/webhookPayload.ts`). Used fields: `caller_number`, `call_started_at` (falls back to `timestamp`), `node_id`, `flow_id` and, for voicemail, `recording.url` and `recording.duration_seconds`.

Responses:

| Status | Meaning | Callytics retries |
| --- | --- | --- |
| 200 | `{"status":"sent"}` after SMTP accepted the mail, or `{"status":"duplicate"}` | no |
| 400 | Invalid JSON or payload, or a recording URL that is not the backend download URL | no |
| 401 | Missing or wrong `X-Callytics-Token` | no |
| 404, 405 | Unknown path or method | no |
| 413 | Body larger than 64 KiB | no |
| 502 | Recording download or SMTP failed | yes (5xx) |
| 503 | Not configured (missing token or SMTP settings) | yes (5xx) |

Duplicates: the same webhook (path, caller, call start, node and recording URL) is mailed once per 10 minutes. A key is stored only after a successful send. A retry that arrives while the first attempt is still running waits for it.

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `NOTIFIER_TOKEN` | none | Shared secret for the `X-Callytics-Token` header. Required. |
| `NOTIFIER_BIND_ADDR` | `127.0.0.1` | Bind address. |
| `NOTIFIER_PORT` | `3005` | Port. |
| `BACKEND_URL` | `http://127.0.0.1:3001` | The only origin recordings are downloaded from. |
| `SMTP_HOST` | none | SMTP server. Required. |
| `SMTP_PORT` | `587` | SMTP port. |
| `SMTP_SECURE` | `false` | `true` for implicit TLS (port 465). |
| `SMTP_USER`, `SMTP_PASS` | none | Optional login. Both or neither. |
| `NOTIFY_FROM` | none | Sender address. Required. |
| `NOTIFY_TO` | none | Recipient or comma separated recipients. Required. |
| `NOTIFY_LANGUAGE` | `nl` | `nl` or `en`. |
| `NOTIFY_TIMEZONE` | `Europe/Amsterdam` | Time zone of the times in the mail. |

Malformed values (for example a bad port) stop the service with a message. Missing token or SMTP settings do not: the service starts, logs a warning and answers 503 to webhooks.

## Security

- Token compared in constant time.
- Recording URL must be exactly `<BACKEND_URL>/recordings/<id>/download` (no credentials, query or fragment). Redirects are not followed. Downloads are capped at 25 MB.
- Request body capped at 64 KiB. Control characters are stripped from text fields.
- The SMTP password is never logged.

## MP3 conversion

`ffmpeg` (in the Docker image) converts the WAV to mono, 16 kHz, 64 kbit/s MP3 (`libmp3lame`). When conversion fails the original WAV is attached and the mail says so.

## Development

```bash
npm install                      # at the repo root
cd notifier
npm test                         # jest, no real SMTP server involved
npm run typecheck
npm run build && NOTIFIER_TOKEN=dev SMTP_HOST=localhost NOTIFY_FROM=a@example.com NOTIFY_TO=b@example.com npm start
```

Source layout (`src/`): `config`, `auth`, `recordingUrl`, `payload` (input handling), `phone`, `time`, `templates` (mail text), `mp3`, `recordingDownload`, `mailer`, `dedupe`, `app` (HTTP routes), `index` (startup).
