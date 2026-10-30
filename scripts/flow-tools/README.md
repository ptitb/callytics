# Flow tools

Command line tools for Callytics flow files (`callytics-flow` v1 JSON, the format of Configure > Templates > Import JSON).

Both tools run the real application code instead of a copy of the rules, so they follow the code when it changes:

- `validate` uses `parseFlowDocument`, `validateNodesConfig`, `validateEdgesConfig` and `collectConfigReferences` from `backend/src/flows`.
- `simulate` uses `resolveNextEdge` and `evaluateBusinessHours` from `stasis/src`.

They are TypeScript files run with `ts-node` (already a dev dependency of `backend` and `stasis`, hoisted to the root `node_modules`). No database, Asterisk or running service is needed. Run `npm install` at the repo root once.

## validate

```bash
npm run flow:validate -- path/to/flow.json
```

- Prints `OK: ...` with node, edge and subflow counts when the import endpoint would accept the file. Exit code 0.
- Prints `INVALID: <reason>` and exits with 1 when the import would be rejected.
- After OK it lists what must be filled in after import: ids equal to the placeholder `999999` and values `REPLACE-ME` or `+31000000000` (a PSTN number, because PSTN targets must be digits). Real-looking ids are listed as `[verify]`, they must exist on the target installation (the import only warns about missing ones).
- It also prints warnings for things the import accepts but the flow editor refuses to save or that break at runtime: menu branches without an edge, missing `open`/`closed` edges, empty timezone, `close` not after `open`, `order` strategy without unique order numbers, unreachable nodes, unknown `on_no_answer` target.

## simulate

```bash
npm run flow:simulate -- path/to/flow.json --at 2026-11-03T10:00 --tz Europe/Amsterdam
npm run flow:simulate -- path/to/flow.json --at 2026-11-06T20:00:00+01:00 --digits 1
npm run flow:simulate -- path/to/flow.json --at 2026-11-03T10:00Z --hunt answered
```

| Option | Meaning |
| --- | --- |
| `--at` | Moment of the call. Use an offset (`+01:00`, `Z`), or no offset together with `--tz` to give wall time in that zone. |
| `--tz` | IANA zone used to read an `--at` without offset. |
| `--digits 1,2` | Digits the caller presses, consumed in order by menus and get_digits. No digit left means a timeout. |
| `--hunt answered\|no-answer` | Outcome of hunt, transfer and queue nodes. Default `no-answer` (follows `on_no_answer`). |

It prints the node path with the result of every node. What it does not do: play audio, talk to Asterisk, dial, query a database or send webhooks (webhook targets are only listed). Business hours are evaluated with the real function, so timezone and `--at` behave as in production. Menu retry prompts are not played, a menu only counts invalid digits until `max_invalid_attempts`.

## Examples

The skill in `.claude/skills/callytics-flow/examples/` holds two files to try the tools on:

```bash
F=.claude/skills/callytics-flow/examples/weekday-hunt-closed-menu.json
npm run flow:validate -- $F
npm run flow:simulate -- $F --at 2026-11-03T10:00 --tz Europe/Amsterdam --hunt no-answer   # Tuesday, hunt then voicemail
npm run flow:simulate -- $F --at 2026-11-06T20:00 --tz Europe/Amsterdam --digits 1         # Friday evening, callback
npm run flow:simulate -- $F --at 2026-11-07T12:00 --tz Europe/Amsterdam --digits 2         # Saturday, weekend message, voicemail
npm run flow:validate -- .claude/skills/callytics-flow/examples/minimal.json
```
