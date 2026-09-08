# Plan 1 — The Platform

**Owner: the platform agent. Do not build the game.**
Develop against stubs in `apps/game` until the real build lands. The only thing you may
assume about the game is [`packages/protocol/contract.ts`](../packages/protocol/contract.ts).
Read that first.

## What it is

A UI where you define N personas, launch N sandboxes, watch each one play live in the
browser with its reasoning streaming beside it, and get a per-persona playtest report at
the end — plus an AI you can interrogate across all reports.

## Architecture

```
Dashboard (Next.js, run locally for the demo)
   │  WS: fleet state, aggregated events, cost meter
   ▼
Orchestrator (Node/TS, local)  ── modal SDK ──▶  N × Modal Sandbox
   │                                                  ├─ static game build (served IN-sandbox)
   ├─ persona registry                                ├─ Chromium + Playwright
   ├─ TPM/RPM governor                                ├─ persona-mcp  ← the sensory gate
   ├─ run archive (JSONL + PNG)                       ├─ codex exec --json  ← the player
   ├─ verification replayer                           └─ viewer service on encrypted_port
   └─ report builder + analyst                              ├─ /live   MJPEG @ 3fps (human view, $0)
                                                            └─ /stream SSE reasoning
```

Two decisions worth stating plainly:

- **The game is served from inside each sandbox**, not fetched over the network. Removes a
  network dependency mid-demo and pins the exact build per run.
- **Human-view fps ≠ agent perception fps.** The viewer streams 3fps so the grid looks
  alive; the agent screenshots every ~5–8s. The pretty stream costs **$0** because it never
  reaches the model. This is why the demo won't feel dead while the agent thinks.

## The agent loop

**Settled by [Spike 01](SPIKE-01-codex-vision.md) — do not redesign this.** Codex drops
image content blocks from MCP results, so perception goes through the filesystem:
`screenshot()` writes a PNG and returns its **path**; the agent opens the file itself.
Verified working against a hidden answer key.

```bash
CODEX_HOME=/agent/home codex exec --json \
  --model gpt-6-astra \
  --skip-git-repo-check \
  --approve-for-me \
  --output-schema /agent/report.schema.json \
  -o /agent/report.json \
  -C /agent \
  "$(cat /agent/persona-brief.md)"
```

- **`--approve-for-me` is required.** Without it MCP calls fail with *"MCP tool call
  requires approval, but approval policy is never."* `mcp_servers.<name>.trusted=true` is
  silently ignored. The `--dangerously-bypass-*` flag is **not** needed anywhere.
- `--json` → JSONL on stdout → parsed into the live reasoning stream.
- `--output-schema` → the final message is a typed `PlaytestReport`. No prose parsing.
- **Keep the persona prefix byte-stable across steps.** Spike 01 measured 92% of input
  served from cache ($1/M vs $10/M). Breaking cache triples the run cost.

## Personas — identities, enforced in the harness

A persona is a **person**, not a slider set. The mechanical dimensions are how that person
is made real.

```yaml
id: maya
name: Maya Chen
age: 24
bio: Twitch streamer, 900h in immersive sims. Playing on stream, chat is watching, hates dead air.
goal: Finish fast enough to keep an audience.
enforcement:
  reading: skim            # ≤12 words visible per text region; the rest redacted IN PIXELS
  genre_familiarity: high  # briefing includes WASD/E/Ctrl conventions
  patience: 3              # consecutive no-progress steps before frustration escalates
  exploration: low
  audio: on
  step_budget: 90
  reasoning_effort: low    # escalates to high on a flagged-confusion step
```

**Enforcement lives in `persona-mcp`, never in the prompt.** Prompt-only personas dissolve
back into a competent patient assistant within ten minutes. That is the entire engineering
argument for this project, and it is the thing to protect when cutting scope.

| Dimension | What the MCP server physically does |
|---|---|
| `reading` | Uses `__telemetry.textRegions()` to **blur text out of the PNG** before the agent can open it |
| `genre_familiarity` | Includes or omits control conventions from the briefing *and* from tool descriptions |
| `patience` | Counts no-progress steps against ground-truth telemetry; escalates frustration, then forces `abandon()` |
| `audio` | Whether the `listen()` tool **exists at all** — `audio: off` means genuinely cannot hear |
| `exploration` | Which success criterion the briefing rewards |
| `step_budget` | Hard cap. **Stagger across the fleet** so reports land at different times |

**Seed personas** (4 for the demo, unlimited by config): Maya Chen (streamer, skims, fast),
Robert Alvarez (52, first PC game, reads everything, knows no conventions), Sam Okafor
(19, speedrunner, objective-only), Priya Nair (31, completionist), and **Dana Kim — plays
with sound off on the bus**, who exists to catch flaw A1 and is the most persuasive
persona in the set.

**Tools exposed to the agent:** `screenshot`, `move`, `look`, `interact`, `use_item`,
`open_inventory`, `type_text`, `listen` (conditional on persona), `note_finding`,
`abandon`. Input-level only — nothing semantic.

## Reports

Per finding: severity · description · frame sequence · **replay-verified** repro steps ·
which personas hit it and how often.
Per persona: the subjective narrative — where they got confused, bored, treated unfairly.

**Bug vs. agent incompetence.** 3+ of 4 personas stalling at the same ground-truth position
means the game; 1 means the agent. Stall is measured from telemetry — no state-change event
within N steps — never from the model's self-report. This is the answer to the
false-positive question and the real reason the fleet exists.

**Verification pass.** Replay each finding's logged input sequence at the same seed and
assert the same `flaw_triggered` / `softlock_entered` event fires. Ship verified findings;
label the rest separately. Repro steps that don't reproduce are the fastest way to lose a
game developer — this single pass is worth more than ten extra personas.

**Scoring.** Join findings against `ledger.json`: recall per flaw class, precision, decoys
falsely flagged, and unledgered findings triaged emergent-vs-false-positive. One table.
It is the answer to every judge question about validity, and nobody else in this space can
produce it because nobody else knows the answer key.

**Cross-report analyst.** One Astra call with all reports in context — cross-report, not a
chatbot per report. Three preset question buttons; never type live. The money answer is
*"three of four missed this; the fourth didn't, because she knew the convention."*

## Cost & rate governance

Measured in Spike 01, not estimated:

| | |
|---|---|
| Per step | **~$0.117** (64,274 input / 59,264 cached / 158 output) |
| Codex CLI system prefix | **~46K tokens**, cached — ~$0.046/step of pure overhead |
| 100-step session | ~$12 / persona |
| 4-persona fleet run | **~$45** |

**The governor is required, not optional.** Tier-1 limits are **500 RPM / 500K TPM**.
Four agents at 8s/step ≈ 240K TPM — fine. Eight agents hits the ceiling. The orchestrator
holds a global token bucket and queues steps rather than eating 429s. Surface **live cost
and TPM headroom in the dashboard**: it makes the inevitable cost question answerable on
stage instead of hand-waved.

## Verification — you are done when all of these pass

1. `pnpm dev:local` — 1 persona, local Playwright, no Modal. The whole loop debuggable
   without touching the cloud. **Build this first; it is where you will live.**
2. `pnpm fleet --personas 4` — 4 Modal sandboxes, 4 live URLs, 4 reports.
3. `pnpm verify --run <id>` — replays every finding; ≥90% of accepted findings reproduce.
4. `pnpm score --run <id>` — prints the precision/recall table against `ledger.json`.
5. Redaction is visibly working: dump a skim-persona screenshot and confirm the text is
   physically blurred, not merely discouraged.
6. Load test: launch 12 sandboxes and confirm the governor throttles instead of 429-ing.
7. Grep every archived agent-visible payload for `__telemetry` and confirm zero hits.
