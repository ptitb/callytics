---
name: callytics-flow
description: Create, edit, validate or import Callytics IVR call flows as JSON (callytics-flow v1, Configure > Templates > Import JSON). Use when the user asks for a call flow, IVR, opening hours routing, hunt group, menu, voicemail or callback flow, or hands over or asks for flow JSON or a flow template.
---

# Callytics flow JSON

This skill describes how to write a flow file that imports cleanly. It can drift from the code. The validator runs the real backend checks, so when this file and `npm run flow:validate` disagree, the validator is right (and this file needs a fix).

Code to read when in doubt: `backend/src/flows/flow-document.ts` (format), `backend/src/flows/flows.service.ts` (`validateNodeConfig`, `validateNodesConfig`, `validateEdgesConfig`), `stasis/src/engine/edgeResolver.ts` and `stasis/src/runtime.ts` (routing), `frontend/src/pages/FlowEditorPage.helpers.tsx` (what the editor refuses to save), `docs-site/features/ivr.md`.

## Workflow

1. Design the flow as nodes and edges first. Ask only for what you cannot invent (timezone, hours, number of days, what happens after hours).
2. Write the JSON file (start from `examples/minimal.json` or `examples/weekday-hunt-closed-menu.json`, or `examples/email-notifications.json` when mails are wanted).
3. `npm run flow:validate -- file.json` from the repo root. Fix every `INVALID` and read every warning.
4. `npm run flow:simulate -- file.json --at <datetime> --tz <zone> [--digits 1,2] [--hunt answered|no-answer]` for each key scenario (open, closed, weekend, each menu digit, no answer). Check the node path, not only the end.
5. Give the user the file plus the fill-in checklist printed by validate (audio files, extensions, numbers, trunks, queues).
6. The user imports it via Configure > Templates > Import JSON, selects the real audio files and extensions in the editor, then publishes.

Simulation covers routing only: no audio, no Asterisk, no dialing (see `scripts/flow-tools/README.md`).

## File format

```json
{
  "format": "callytics-flow",
  "version": 1,
  "name": "Flow name",
  "description": "Optional",
  "nodes": [{ "nodeKey": "start", "type": "start", "label": "Start", "config": { "flow_default_timeout_ms": 10000 }, "positionX": 0, "positionY": 0 }],
  "edges": [{ "sourceNodeKey": "start", "targetNodeKey": "next", "branchKey": "default" }],
  "subflows": []
}
```

- Only `nodes` is required (non-empty). `format` and `version`, if present, must be exactly `callytics-flow` and `1`.
- `nodeKey` is unique per flow level. Every edge endpoint must exist. Use readable keys (`bh_monday`, `hunt_monday`).
- Exactly one `start` node. For the main flow set `config.flow_default_timeout_ms` (1000 to 120000, default applied is 120000).
- Positions only affect the editor layout. Use a grid, for example 420 px per column and 150 to 250 px per row.
- `subflows` (menu submenus) are separate flows nested in the file, linked by `parentNodeKey` (a menu) and `parentBranchKey` (digit, `*` or `#`). Each has its own `start` node. They are optional, fall back to plain edges when you can.
- Ids of database rows are never portable. See Placeholders.

## Edges

- Plain edges: `branchKey: "default"`, no `condition`.
- Branching nodes: write `branchKey` and `condition` with the same value, and `sourceHandle` too if you want the editor to attach it to the right handle (the editor writes all three equal).
  - `business_hours`: `open` and `closed`.
  - `menu`: one edge per digit in `config.branches`, value = digit (`1`, `2`, `*`, `#`, 1 to 2 characters). `complete` is the edge a submenu returns to.
  - `get_digits`: `condition` is required on every edge: digit, `timeout`, `invalid` or `default`.
  - `queue`: results are `connected`, `timeout`, `abandoned`. A result without an edge ends the call as failed.
- Resolution (`edgeResolver.ts`): if any outgoing edge has a `condition`, only conditions are matched (result, then `default`, then a null condition). Otherwise `branchKey` is matched (result, then `default`, then null condition).
- `hunt` and `transfer` leave the node by `on_no_answer` (a nodeKey of the same flow, no edge needed). After a connected call ends, an edge from hunt (or voicemail/callback) is followed if present, otherwise the call ends. Do not add a hangup edge after hunt.
- A `webhook` node can be the target of an edge from any node, including terminal ones. Such edges are side effects (fired, never waited for) and skip all other edge checks.

What the import rejects (`validateEdgesConfig`):

- Source or target node missing.
- Outgoing edges from `hangup`, `transfer`, `voicemail`, `callback`, `queue_login` (except to a webhook). Transfer is terminal in the validator even though the runtime could continue after it.
- `start` to anything except: play_audio, menu, business_hours, transfer, hunt, queue, queue_login, hangup, conference, webhook, callback, voicemail. So `start` cannot go straight to `get_digits`.
- `get_digits` as target from anything except `play_audio`, `menu`, `business_hours`, `webhook` (not `start`).
- `queue_login` as target from anything except `start`, `menu`, `play_audio`, `get_digits`.
- `voicemail` as target from `hunt`, `transfer`, `queue`, `queue_login`. Voicemail on no answer is done with `on_no_answer`, not an edge.
- Missing `condition` on edges from `menu` or `get_digits`. Menu conditions other than a digit, `*`, `#` or `complete`. get_digits conditions outside digit, `*`, `#`, `timeout`, `invalid`, `default`.

## Nodes

Results the runtime produces and where it goes next. "Terminal" means the validator allows no outgoing edges.

| type | required config | useful optional config | result and edges | terminal |
| --- | --- | --- | --- | --- |
| `start` | `flow_default_timeout_ms` (main flow) | | `default` | no |
| `play_audio` | `audio_file_id` | | `default`; an unconnected play_audio hangs up | no |
| `menu` | `prompt_audio_file_id`, `branches` (array of digit strings) | `timeout_ms`, `max_timeout_attempts`, `max_invalid_attempts` (default 3), `timeout_prompt_audio_id`, `invalid_prompt_audio_id`, `final_failure_audio_id`, `submenu_branch_names` | digit from `branches`; one edge per branch | no |
| `get_digits` | `variable_name`, `timeout_ms` | `prompt_audio_file_id` | digit, `timeout`, `invalid` (conditions required) | no |
| `business_hours` | `timezone`, `schedule` with at least one `enabled` day | | `open`, `closed` | no |
| `hunt` | `destinations` (>=1) | `strategy`, `attempt_timeout_ms` (20000), `total_timeout_ms` (60000), `on_no_answer`, `hold_audio_file_id`, `busy_audio_file_id`, `record_call`, `send_to_webhook` | answered: `done`; else `route:<on_no_answer>` or hangup; optional continuation edge after `done` | no |
| `transfer` | `target_type` (`extension`, `pstn`, `sip_uri`), `target_value` | `timeout_ms` (30000), `on_no_answer`, `trunk_id` (pstn), `waiting_sound_id`, `no_answer_sound_id`, `record_call`, `send_to_webhook` | answered: `done`; else `route:<on_no_answer>` or hangup | yes |
| `voicemail` | `start_audio_id` | `mailbox_name` (default `main`), `max_duration_seconds` (60), `end_audio_id`, `send_to_webhook` | `done` | yes |
| `callback` | `number_source` (`ani` or `dtmf`), `destination_value` | `destination_type` (`operator`, `extension`, `pstn`, `caller`), `operator_id`, `destination_trunk_id`, `dtmf_prompt_audio_id`, `dtmf_max_digits` (1 to 20, only for `dtmf`), `confirmation_audio_id` | `done` | yes |
| `queue` | `queue_id` | `prompt_audio_file_id`, `record_call` | `connected`, `timeout`, `abandoned` | no |
| `queue_login` | `queue_ids` (>=1 positive ids) | `prompt_audio_file_id`, `wrong_pin_audio_file_id`, `login_success_audio_file_id`, `use_flow_default_timeout`, `input_timeout_ms` | `authenticated` | yes |
| `conference` | `roomName` (letters and digits only) | `waitForModerator`, then `moderatorType` (`extension`/`pstn`) and `moderatorId` are required; `participants` | `default` | no |
| `webhook` | `url` (http or https) | `method` (`POST`/`GET`), `headers`, `include_caller`, `include_session_variables`, `retry_enabled`, `max_attempts`, `timeout_ms` | fire and forget side effect | n/a |
| `hangup` | none | | ends the call | yes |
| `group` | none | editor only, a visual frame | never executed | n/a |

Details that matter:

- Timeouts (`timeout_ms`, `input_timeout_ms`, start default) must be integers from 1000 to 120000.
- `hunt` destinations: `{ "target_type": "extension" | "pstn", "target_value": "...", "trunk_id"?: n, "order"?: n }`. Strategies: `sequential` (default), `random`, `group`, `order`. `order` needs a unique positive `order` on every destination (the editor refuses to save otherwise, the import does not check). An extension value is letters, digits, `_`, `-` (1 to 64 chars). A pstn value is `+` optional and 4 to 20 digits.
- `transfer` extension and pstn values follow the same patterns, `sip_uri` must look like `sip:user@host`.
- `business_hours`: schedule keys `monday` to `sunday`, each `{ "enabled": bool, "open": "HH:MM", "close": "HH:MM" }`. `close` is inclusive (17:00 means 17:00 is still open). A day needs `close` after `open`, no crossing midnight (use `00:00` to `23:59`). Empty timezone means always `closed`. Write all seven days, set the unused ones to `enabled: false`.
- `menu`: after `max_timeout_attempts` timeouts or `max_invalid_attempts` wrong digits the menu plays `final_failure_audio_id` and hangs up. There is no timeout or invalid edge, so an after-hours menu cannot loop back or fall through.
- Editor save rules the import does not check (validate warns): every menu branch needs an edge (or a subflow), `start`, `get_digits`, `business_hours` and `conference` need at least one outgoing edge, a flow that is only start to hangup cannot be published.

## Placeholders

Real ids belong to one installation, so a generated file cannot know them, but the import refuses empty required values. Convention:

- Audio file ids: `999999`. Import accepts it and lists a warning per missing audio file. Optional audio stays `null`.
- Extension, callback destination and other text values: `"REPLACE-ME"`. The import raises no warning for these, so list them for the user (validate does).
- pstn targets must be digits, so `REPLACE-ME` fails there. Use `+31000000000`.
- Trunk, queue and operator ids: `999999` as well, when the field is required. Leave optional ones out or `null`.
- Say in the node `label` when something needs filling in, for example `"Hunt Monday (add agents)"`.

## Patterns

Per-weekday hunt chain: one `business_hours` node per weekday (only that day enabled, same hours). `open` goes to that day's `hunt`, `closed` goes to the next day's `business_hours`. The last day's `closed` leaves the chain. Each hunt has `on_no_answer` pointing at a `voicemail` node (no edge from hunt to voicemail). Hunt has no outgoing edge. This is the structure of `examples/weekday-hunt-closed-menu.json`. A single `business_hours` with all days works when hours are identical on every day.

Weekend versus weekday evening: after the last weekday node add one more `business_hours` (`bh_weekend`) with only Saturday and Sunday enabled, `00:00` to `23:59`. `open` plays the weekend message, `closed` plays the evening message, both lead to the same closed menu.

Closed menu: `play_audio` (message) then `menu` with branches `1` and `2`, for example `1` to `callback` (`number_source: "ani"`) and `2` to `voicemail`. Both are terminal, so the menu ends the flow. Remember timeout and invalid digits hang up.

Voicemail on no answer: `hunt` or `transfer` with `on_no_answer` set to the voicemail nodeKey.

Webhook on an event: draw an edge from the node to a `webhook` node. It fires when that node completes.

E-mail notifications (missed call and voicemail, needs the `notifier` service, see `INSTALL.md` section "E-mailmeldingen"): see `examples/email-notifications.json`.

- A `webhook` node only fires through an edge from another node. A webhook that is itself the `on_no_answer` target or a step on the route is never executed (it has no executor, the runtime moves on without firing it). Do not put it between hunt and voicemail.
- Missed call: set the hunt's `on_no_answer` to a `play_audio` node ("nobody available"). Draw two default edges from that node: one to the `voicemail` node (or another continuation) and one to a `webhook` node. Both are followed, the webhook as a side effect. The webhook payload then has `node_type` `play_audio` and the `node_id` of that node.
- Voicemail: draw an edge from the `voicemail` node to a second `webhook` node. It fires after the recording is saved and the call has ended, and its payload carries `recording.url` and `recording.duration_seconds`.
- Webhook config: `method` `POST`, `timeout_ms` `30000` (default 5000 is too short for a voicemail), `headers` `[{ "key": "X-Callytics-Token", "value": "REPLACE-ME" }]` (the real value is `NOTIFIER_TOKEN` from `.env`).
- URLs, one path per event so the notifier never guesses: `http://127.0.0.1:3005/webhooks/missed-call` and `http://127.0.0.1:3005/webhooks/voicemail`. Use another host or port only when `NOTIFIER_BIND_ADDR` or `NOTIFIER_PORT` differ.
- Add `REPLACE-ME` for the token to the fill-in checklist you give the user.

Greeting then agents: `start` to `play_audio` to `hunt` (see `examples/minimal.json`).

## Known limitations

- Menu timeout or invalid input hangs up, no edge for it.
- Business hours cannot cross midnight, and each node evaluates the clock in its own timezone.
- `hunt` to `voicemail` and `transfer` to `voicemail` edges are rejected, use `on_no_answer`.
- Transfer, voicemail, callback, queue_login, hangup cannot have outgoing edges.
- Business hours edges are `open` and `closed` (older docs called them `in-hours` and `out-of-hours`).
- A `queue` result without an edge ends the call as failed (read from `runtime.ts`, not run). Add edges for `connected`, `timeout` and `abandoned`. `conference` participants are not covered here.
