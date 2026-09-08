# Orchestrator

Node 22 server on **:4000** that launches a fleet of persona runners (one per persona, any
number of personas), tails their `SessionEvent`s into a live fleet view, governs the fleet's
token rate, archives every run under `runs/<runId>/`, and calls the analysis CLI when a run
finishes. Implements the `ORCHESTRATOR — HTTP/WS API` in
[`docs/INTERFACES.md`](../../docs/INTERFACES.md) exactly; the dashboard consumes it.

```
apps/orchestrator/
  src/index.mjs          boot: personas → game server (:5273) → governor → runs → HTTP+WS
  src/api.mjs            every route + /ws FleetEvents + MJPEG/SSE proxying
  src/runs.mjs           RunManager: create/start/stop, PersonaLive state, run.json, analysis hook
  src/governor.mjs       global token bucket, start queue, pause/resume, budget stagger
  src/backends/local.mjs spawns the runner CLI on this machine
  src/backends/modal.mjs drives infra/modal/sandbox.py (one Modal Sandbox per persona)
  src/analysis.mjs       shells out to packages/analysis/cli.mjs, falls back if absent
  src/personas.mjs       registry over packages/persona-mcp/personas/*.json
  dev/fake-runner.mjs    stand-in runner: real game in real Chromium, random walk, $0
infra/modal/
  image.py               sandbox image (Debian + Node 22 + pnpm + Playwright Chromium + Codex CLI)
  sandbox.py             run | build | probe | list | cleanup
  serve-game.mjs         serves apps/game/dist on 5273 inside the sandbox
```

## Run it

```bash
pnpm install
pnpm --filter station-kepler build            # apps/game/dist — the orchestrator serves it on :5273

# local backend with the REAL runner (default RUNNER_CMD):
node apps/orchestrator/src/index.mjs

# local backend with the fake runner (no Codex, no cost; good for the dashboard):
RUNNER_CMD="node apps/orchestrator/dev/fake-runner.mjs" RUNNER_PAUSE_SIGNALS=1 \
FAKE_STEP_MS=2500 RUNNER_MAX_STEPS=20 node apps/orchestrator/src/index.mjs
```

Then:

```bash
curl -X POST :4000/api/runs -H 'content-type: application/json' \
  -d '{"personas":["maya","robert","sam","priya"],"seed":7,"backend":"local"}'
# → {"runId":"20260908-203324-4843"}
curl :4000/api/runs/<runId>                    # RunMeta + personas: PersonaLive[]
curl -N :4000/api/runs/<runId>/maya/stream     # SSE of SessionEvent
open  http://127.0.0.1:4000/api/runs/<runId>/maya/live   # MJPEG (3 fps)
```

`personas` may repeat (`["maya","maya","sam"]`); duplicates are keyed by occurrence
(`maya`, `maya-2`) and that key is what `:persona` means in every route and in
`PersonaLive.id` (`personaId` carries the registry id).

## Backends

| | `local` | `modal` |
|---|---|---|
| where | this machine, one runner process per persona | one Modal Sandbox per persona (`infra/modal/`) |
| game | served by the orchestrator on `:5273` (`GAME_URL` to override) | served **inside** the sandbox on 5273 |
| runner | `RUNNER_CMD` + `--persona --game-url --seed --out --viewer-port [--max-steps]` | `MODAL_RUNNER` (default `/app/packages/persona-mcp/runner.mjs`; falls back to fake-runner if missing) |
| `/live` `/stream` | proxied from `127.0.0.1:<viewer-port>` | proxied from the sandbox's encrypted tunnel (port 8080) |
| pause | SIGUSR1/SIGUSR2 to the runner when `RUNNER_PAUSE_SIGNALS=1` | `pkill -USR1/-USR2` inside the sandbox |
| archive | runner writes `runs/<runId>/<key>/` directly | downloaded (tar) from `/out/<key>` when the runner exits |
| codex auth | runner's business (`CODEX_API_KEY` or `~/.codex/auth.json`) | Modal Secret `codex-api-key`, created from local `CODEX_API_KEY` if missing; if neither exists the run says so and only the fake runner can work |

### Modal

```bash
modal profile current                          # any authenticated profile; nothing is hardcoded
cp .env.example .env && $EDITOR .env           # CODEX_API_KEY=… (optional: MODAL_PROFILE=…)
PY=$(sed -n '1s/^#!//p' "$(which modal)")      # the interpreter that has the `modal` package
$PY infra/modal/sandbox.py build               # first build ≈ minutes; later runs reuse it
$PY infra/modal/sandbox.py probe --save-dir /tmp/probe   # one sandbox: boot time, size, screenshot, tunnel
$PY infra/modal/sandbox.py list | cleanup      # never leak sandboxes
```

The orchestrator finds that interpreter the same way (`MODAL_PYTHON` overrides). Then
`POST /api/runs {"backend":"modal", …}`. Built artifacts are **mounted** into the sandbox at
start (`apps/game/dist`, `packages/persona-mcp`, `packages/protocol`, `apps/orchestrator/dev`),
so only dependency changes need an image rebuild (`build --force`).

## The governor

A global sliding-window token bucket fed by `usage` SessionEvents (tier-1: 500K TPM / 500 RPM).

- New persona starts are **queued** and released only while headroom ≥ 15%, at most one
  every `START_STAGGER_MS` (1.5s) and at most `MAX_STARTING` (3) booting at once.
- Over the limit → pause the heaviest recent consumer (one per tick); back above 25%
  headroom → resume one. Needs a runner that honours pause signals (`RUNNER_PAUSE_SIGNALS=1`;
  fake-runner does, the modal backend always does). Otherwise it only staggers starts.
- **Step budgets are staggered ±15%** per persona (deterministic in seed+index) so reports
  land at different times. `RUNNER_MAX_STEPS` / `POST …{"maxSteps":N}` cap runs for demos.
- Counted tokens default to `input − cached + output` (the plan's arithmetic);
  `GOVERNOR_COUNT_CACHED=1` counts everything.
- `{ type:'governor', tpmUsed, tpmLimit, queued, rpmUsed, rpmLimit, starting, paused, headroom }`
  goes out on `/ws` every 2s; `{ type:'governor.throttle', key, action }` on pause/resume.

## API

Exactly the treaty routes (all responses carry `Access-Control-Allow-Origin: *`):

```
GET  /api/health                           { ok, runs, governor }
GET  /api/personas                         PersonaConfig[]
POST /api/personas                         PersonaConfig → 201 (validated; upserts <id>.json)
POST /api/runs                             { personas: string[], seed?, backend, maxSteps? } → 201 { runId }
GET  /api/runs                             RunMeta[]
GET  /api/runs/:id                         RunMeta & { analysis, personas: PersonaLive[] }
POST /api/runs/:id/stop                    { ok, status }
GET  /api/runs/:id/:persona/session        SessionEvent[]
GET  /api/runs/:id/:persona/stream         SSE: `data: <SessionEvent>`; `event: end` when the persona exits
GET  /api/runs/:id/:persona/live           MJPEG from the runner's viewer; falls back to the newest agent frame at 1 fps
GET  /api/runs/:id/:persona/frames/:n      PNG (n = 12 | 00012 | 00012.png); proxied from the sandbox if not yet downloaded
GET  /api/runs/:id/:persona/report         PlaytestReport (404 until written)
GET  /api/runs/:id/analysis                { findings, score, reportMd, source } · 202 while running/pending
POST /api/runs/:id/analysis/ask            { question } → { answer } · 503 if the analysis CLI is absent
GET  /api/runs/:id/export.zip              the whole runs/<runId>/ directory
WS   /ws                                   FleetEvents; on connect: governor + persona.status catch-up
```

`PersonaLive.liveUrl/streamUrl` are absolute (`PUBLIC_BASE_URL`, default `http://127.0.0.1:4000`).
`persona.step.frame` is the runner's relative frame path (`frames/00012.png`) — map it to `/frames/12`.

### Analysis hook

When every persona of a run is terminal: `run.json` → `done|failed|stopped`, then
`node packages/analysis/cli.mjs cluster | verify | score | report --run runs/<runId>` in
order (each guarded, timed out), then `run.done` on `/ws`. If the CLI is missing or a step
fails, whatever is missing under `analysis/` is filled with a **fallback** (findings
concatenated across reports, empty score, markdown digest) and `analysis/meta.json` says so.

## Environment

| var | default | |
|---|---|---|
| `PORT` | 4000 | |
| `PUBLIC_BASE_URL` | `http://127.0.0.1:4000` | prefix for `liveUrl`/`streamUrl` |
| `RUNS_DIR` | `runs` | archive root |
| `GAME_DIST` / `GAME_PORT` / `GAME_URL` | `apps/game/dist` / 5273 / `http://127.0.0.1:5273/` | local game |
| `RUNNER_CMD` | `node packages/persona-mcp/runner.mjs` | local runner command prefix |
| `RUNNER_NO_VIEWER` | 0 | 1 = don't pass `--viewer-port` |
| `RUNNER_PAUSE_SIGNALS` | 0 | 1 = runner honours SIGUSR1/SIGUSR2 |
| `RUNNER_MAX_STEPS` | — | cap every persona (staggered) |
| `VIEWER_PORT_BASE` | 9100 | first viewer port for local runners |
| `TPM_LIMIT` / `RPM_LIMIT` | 500000 / 500 | |
| `GOVERNOR_HEADROOM` / `START_STAGGER_MS` / `MAX_STARTING` / `BUDGET_STAGGER` | 0.15 / 1500 / 3 / 0.15 | |
| `ANALYSIS_CLI` / `LEDGER_PATH` | `packages/analysis/cli.mjs` / `apps/game/src/flaws/ledger.json` | |
| `MODAL_PYTHON` / `MODAL_RUNNER` / `MODAL_APP_NAME` / `MODAL_SECRET_NAME` | derived / `/app/packages/persona-mcp/runner.mjs` / `synthetic-playtest` / `codex-api-key` | |
| `FAKE_STEP_MS` / `FAKE_FINDING_RATE` | 4000 / 0.7 | fake-runner pacing (inherited by runners) |

`.env` at the repo root is loaded at boot (never committed).

## Fake runner

`dev/fake-runner.mjs` implements the RUNNER CLI contract so everything downstream can be built
before the Codex-driven runner lands: it loads the real game in Chromium, walks at random,
emits `status/codex/action/usage/telemetry/finding/gate` SessionEvents (usage modelled on
Spike-01), writes `persona.json`, `session.jsonl`, `frames/`, `report.json`, `cost.json`, and
serves `/live` (MJPEG 3 fps) · `/stream` (SSE) · `/frames/:n` · `/health` on `--viewer-port`.
SIGUSR1 pauses, SIGUSR2 resumes, SIGTERM → `status: stopped`, exit 143. Swap in the real one
by unsetting `RUNNER_CMD`.
