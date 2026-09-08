# Synthetic Playtesting

A fleet of persona-driven agents that play your game like real beta testers and return a
playtest report — not just crashes, but **confusion, boredom, and unfairness**.

Every funded player in AI game testing finds *objective* failures: crashes, soft-locks,
stuck geometry. None of them find *subjective* ones — was the tutorial confusing, where
did I get bored, did that boss feel unfair or just hard. That is what studios pay human
playtesters weeks and real money for, and that is the hole this fills.

Powered end to end by **`gpt-6-astra`** via the **Codex CLI**.

## Why the numbers here are real

We build the game too, with a **known set of deliberately injected flaws** (`ledger.json`).
So unlike anyone else in this space, we can publish a **precision/recall score** — flaws
injected vs. flaws found — plus decoys that measure false positives. We know the answer key.

## Layout

| Path | What |
|---|---|
| `apps/game/` | "Station Kepler" — 3D first-person WebGL game with injected flaws |
| `apps/dashboard/` | Fleet grid, live agent view + reasoning, reports, analyst chat |
| `apps/orchestrator/` | Sandbox control, rate governor, run archive, verifier, reports |
| `packages/protocol/` | Shared contract between game and platform |
| `packages/persona-mcp/` | The sensory gate — persona enforcement lives here |
| `infra/modal/` | Sandbox image |
| `spikes/` | De-risking experiments, with results in `docs/` |

## Plans

- [`docs/PLAN-PLATFORM.md`](docs/PLAN-PLATFORM.md) — the platform
- [`docs/PLAN-GAME.md`](docs/PLAN-GAME.md) — the game and its flaw ledger
- [`docs/SPIKE-01-codex-vision.md`](docs/SPIKE-01-codex-vision.md) — ✅ proves agents can see

## Run it

```bash
pnpm install
pnpm stack        # builds what's missing, then: orchestrator :4000 · game :5273 · dashboard :3000
```

(Separately if you prefer: `pnpm orchestrator`, and `cd apps/dashboard && pnpm build && pnpm start`.)

Then open http://localhost:3000, pick personas (as many as you like — duplicates allowed),
and Launch. Each pane is a live MJPEG feed of that persona's browser with one line of its
current reasoning; click to expand. Reports land per persona as they finish; the fleet
report (clusters, replay verification, scorecard against `ledger.json`, analyst) appears
when the last one does.

One persona, no UI:

```bash
pnpm serve:game &                 # :5273
pnpm runner -- --persona packages/persona-mcp/personas/maya.json \
  --game-url http://127.0.0.1:5273/ --seed 186 --out runs/dev/maya --max-steps 40
node packages/analysis/cli.mjs cluster --run runs/dev && node packages/analysis/cli.mjs report --run runs/dev --html
```

Auth: locally the runner reuses your Codex CLI login (`~/.codex/auth.json`); set
`CODEX_API_KEY` for headless or Modal use. `pnpm test` runs the game's determinism suite,
the persona-mcp smoke and the runner tests.

## What a real run looks like

Five personas, full budgets, $33.22: **3 of 15 injected flaws found, no false alarms,
one thing nobody planted** — four of five testers stalled at the concourse's identical,
feedback-less locked doors, which gated them out of 80% of the game. The one who got
through soft-locked, wrote a repro-quality bug report in character, and the game's own
telemetry confirmed it. Details and the cost curve in
[`docs/PLAN-PLATFORM.md`](docs/PLAN-PLATFORM.md#what-the-first-real-fleet-run-actually-produced-2026-09-08).

## Setup

```bash
cp .env.example .env    # fill in CODEX_API_KEY etc. .env is git-ignored.
pnpm install
```

Never commit secrets. `.env*`, `codex-home/`, and `runs/` are git-ignored.

## License

MIT
