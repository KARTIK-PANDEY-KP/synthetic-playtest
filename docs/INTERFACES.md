# Interfaces & ownership

Five workstreams build in parallel. This file is the treaty. Types live in
[`packages/protocol/contract.ts`](../packages/protocol/contract.ts); read it first.

## Ownership — touch only your own tree

| Workstream | Owns | Consumes |
|---|---|---|
| **GAME** | `apps/game/**` | contract.ts §1–4 |
| **RUNNER** | `packages/persona-mcp/**` (server.mjs, runner.mjs, brief.mjs; may edit driver.js) | game build, report.schema.json |
| **ORCHESTRATOR** | `apps/orchestrator/**`, `infra/modal/**` | runner CLI, analysis package |
| **ANALYSIS** | `packages/analysis/**` | run archive layout, ledger.json |
| **DASHBOARD** | `apps/dashboard/**` | orchestrator HTTP/WS API below |

Shared: `packages/protocol/**` — additive changes only, never rename or remove. Root
`package.json` scripts: add yours under your own package; root wiring happens at merge.

## Ports

| Service | Port |
|---|---|
| game (static) | 5273 |
| orchestrator | 4000 |
| dashboard | 3000 |
| sandbox viewer (inside each sandbox) | 8080 |

## RUNNER — CLI contract

```
node packages/persona-mcp/runner.mjs \
  --persona packages/persona-mcp/personas/maya.json \
  --game-url http://127.0.0.1:5273/ \
  --seed 7 \
  --out runs/<runId>/maya \
  [--max-steps N] [--codex-home DIR]
```

- Writes the persona dir per the **run archive layout** in contract.ts.
- Streams `SessionEvent` JSON lines to **stdout** as they happen (the orchestrator
  tails this for the live view) and to `session.jsonl`.
- Exit 0 when `report.json` is written; non-zero on failure with a `status: failed` line.
- Runs `codex exec --json --approve-for-me --output-schema report.schema.json -m gpt-6-astra`
  with a per-run `CODEX_HOME` whose `config.toml` registers `server.mjs` as MCP server `game`.
- Auth: `CODEX_API_KEY` if set, else copies `~/.codex/auth.json` into the run's CODEX_HOME.

## RUNNER — MCP tools exposed to the agent

`screenshot` · `move(direction, ms)` · `look(direction, ms)` · `crouch(on)` · `interact` ·
`use_item(name)` · `open_inventory` · `type_text(text)` · `listen` (**only if `audio: on`**) ·
`note_finding(Finding)` · `abandon(reason)`.

`screenshot` returns a **file path**, not an image (Codex drops image blocks — see SPIKE-01).
Input-level only. Nothing semantic.

## ORCHESTRATOR — HTTP/WS API (dashboard consumes this)

```
GET  /api/personas                         PersonaConfig[]
POST /api/personas                         PersonaConfig → 201
POST /api/runs                             { personas: string[], seed?: number, backend: 'local'|'modal' } → { runId }
GET  /api/runs                             RunMeta[]
GET  /api/runs/:id                         RunMeta & { personas: PersonaLive[] }
POST /api/runs/:id/stop                    → 200
GET  /api/runs/:id/:persona/session        SessionEvent[]
GET  /api/runs/:id/:persona/stream         SSE of SessionEvent (live)
GET  /api/runs/:id/:persona/live           MJPEG of the browser (3 fps, human view, costs $0)
GET  /api/runs/:id/:persona/frames/:n      PNG the agent actually saw
GET  /api/runs/:id/:persona/report         PlaytestReport
GET  /api/runs/:id/analysis                { findings: ClusteredFinding[], score: Score, reportMd: string }
POST /api/runs/:id/analysis/ask            { question } → { answer }
GET  /api/runs/:id/export.zip              whole archive
WS   /ws                                   fleet events (below)
```

```ts
interface PersonaLive {
  id: string; status: PersonaStatus; steps: number; cost: CostSummary;
  lastReasoning?: string;        // ONE line for the grid pane
  liveUrl: string; streamUrl: string;
}
type FleetEvent =
  | { type: 'persona.status'; runId; persona; status: PersonaStatus }
  | { type: 'persona.step';   runId; persona; step: number; reasoning?: string; frame?: string }
  | { type: 'persona.finding'; runId; persona; finding: Finding }
  | { type: 'persona.cost';   runId; persona; cost: CostSummary }
  | { type: 'run.done';       runId }
  | { type: 'governor';       tpmUsed: number; tpmLimit: number; queued: number };
```

Backends: `local` spawns the runner CLI on this machine per persona; `modal` creates one
Modal Sandbox per persona from `infra/modal/` and proxies `/live` + `/stream` from the
sandbox's encrypted port. The governor is a global token bucket (tier-1: 500K TPM) that
delays `screenshot` grants when headroom is low — never lets a 429 reach the agent.

## ANALYSIS — CLI contract

```
node packages/analysis/cli.mjs cluster  --run runs/<runId>                     → analysis/findings.json
node packages/analysis/cli.mjs verify   --run runs/<runId> --game-url URL       → sets verified on each finding
node packages/analysis/cli.mjs score    --run runs/<runId> --ledger apps/game/src/flaws/ledger.json → analysis/score.json
node packages/analysis/cli.mjs report   --run runs/<runId>                     → analysis/report.md
node packages/analysis/cli.mjs ask      --run runs/<runId> "question"          → answer (stdout)
```

`ask` uses `codex exec -m gpt-6-astra` with all reports in the prompt (OpenAI-native, no
API key needed locally). Attribution rule: 3+ personas stalling at the same ground-truth
position ⇒ `game`; 1 ⇒ `agent`. Stall is read from `telemetry` events, not self-report.

## GAME — extra contract beyond contract.ts

- `?replay=<url>` fetches a JSON action log `[{t, tool, args}]` and re-applies it with the
  same seed; emits identical telemetry. **Verification depends entirely on this.**
- Ships `apps/game/scripts/perfect-player.json` — an action log that completes the game and
  triggers every non-decoy flaw. ANALYSIS uses it as a fixture.
- `pnpm --filter station-kepler build` → `apps/game/dist/` — static, no runtime fetches
  except `?replay`.

## Ground rules for every workstream

- **Verify by running it.** Report what you ran and what you saw. Never claim untested.
- Path has a space (`astra hackathon`). Use `fileURLToPath`, never `URL.pathname`.
- The author's employer/org name must not appear anywhere in this repo — not in code,
  config, docs, or commit messages. No secrets in the tree; `.env*`, `codex-home/`,
  `runs/` are ignored.
- Commit messages: conventional commits, trailer `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- `window.__telemetry` must never reach the agent. Grep your agent-visible payloads for it.
