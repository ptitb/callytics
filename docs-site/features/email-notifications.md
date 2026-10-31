# E-mail Notifications

The `notifier` service turns flow webhooks into e-mails sent to one general address:

- **Missed call:** caller number and time.
- **New voicemail:** caller number, time, duration and the recording as an MP3 attachment.

It runs next to the other services in `docker compose` and listens on `127.0.0.1:3005`. Callytics reaches it through [Webhook nodes](/features/ivr) in a flow. Without SMTP settings it still starts and answers `503` to webhooks, so existing installations keep working.

## Configure

Add the following to `.env`. `scripts/install.sh` generates `NOTIFIER_TOKEN`.

| Variable | Default | Meaning |
| --- | --- | --- |
| `NOTIFIER_TOKEN` | generated | Shared secret, sent by the Webhook nodes in the `X-Callytics-Token` header |
| `SMTP_HOST` | none | SMTP server (required) |
| `SMTP_PORT` | `587` | SMTP port |
| `SMTP_SECURE` | `false` | `true` for implicit TLS on port 465 |
| `SMTP_USER`, `SMTP_PASS` | none | Optional login, set both or neither |
| `NOTIFY_FROM` | none | Sender address (required) |
| `NOTIFY_TO` | none | Recipient, or comma separated recipients (required) |
| `NOTIFY_LANGUAGE` | `nl` | Mail language, `nl` or `en` |
| `NOTIFY_TIMEZONE` | `Europe/Amsterdam` | Time zone of the times in the mail |
| `NOTIFIER_BIND_ADDR`, `NOTIFIER_PORT` | `127.0.0.1`, `3005` | Where the service listens |
| `BACKEND_URL` | `http://127.0.0.1:3001` | Only origin recordings are downloaded from |

Then start it:

```bash
docker compose up -d --build notifier
docker compose logs -f notifier
```

## Flow setup

A Webhook node only fires when another node has an edge to it. A Webhook node used as a step on a route (for example the target of a hunt's `on_no_answer`) is not executed. The missed call webhook therefore hangs on a Play audio node:

1. Set the hunt's `on_no_answer` to a **Play audio** node ("nobody is available").
2. From that Play audio node, draw one edge to the **Voicemail** node and one edge to a **Webhook** node (missed call).
3. From the Voicemail node, draw an edge to a second **Webhook** node (voicemail). It fires after the recording is saved and the call has ended.

| | Missed call | Voicemail |
| --- | --- | --- |
| URL | `http://127.0.0.1:3005/webhooks/missed-call` | `http://127.0.0.1:3005/webhooks/voicemail` |
| Method | `POST` | `POST` |
| Header | `X-Callytics-Token: <NOTIFIER_TOKEN>` | same |
| Timeout | 30000 ms | 30000 ms |

Set the timeout to 30000 ms. The default is 5000 ms, which can be too short to download and convert a voicemail. Retries of the same webhook within 10 minutes are recognised and mailed once.

A ready-made flow is in `.claude/skills/callytics-flow/examples/email-notifications.json` (Configure > Templates > Import JSON).

## Test

```bash
curl -s http://127.0.0.1:3005/health

curl -s -X POST http://127.0.0.1:3005/webhooks/missed-call \
  -H 'Content-Type: application/json' \
  -H 'X-Callytics-Token: <token>' \
  -d '{"caller_number":"31612345678","node_id":"no_answer_msg","call_started_at":"2026-11-03T09:01:05.000Z"}'
```

`{"status":"sent"}` means SMTP accepted the mail.

## Behaviour and security

- `200` is returned only after the SMTP server accepted the mail. `5xx` (SMTP or download failure, not configured) makes Callytics retry. `4xx` is not retried.
- `401` without the correct `X-Callytics-Token`.
- A recording is only downloaded from `<BACKEND_URL>/recordings/<id>/download`. Any other host or path is refused with `400`.
- The recording is converted to mono 16 kHz 64 kbit/s MP3 with ffmpeg. If that fails, the WAV is attached and the mail says so.
- The service listens on `127.0.0.1` by default. Keep it that way when Callytics runs on the same host.

## Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| `503 Notifier is not configured` | The listed variables are missing in `.env`. Set them and run `docker compose up -d notifier`. |
| `401` | The header is missing or differs from `NOTIFIER_TOKEN`. |
| `400 recording.url does not point to the configured backend` | `BACKEND_URL` in `.env` differs from the host in the webhook. |
| `502 The mail server did not accept the message` | See `docker compose logs notifier` (`SMTP send failed`). Check host, port, `SMTP_SECURE`, credentials and sender. |
| No mail for a missed call | The Webhook node must hang on a Play audio node, not on the hunt. Look for `[webhook] fired` in `docker compose logs stasis`. |
