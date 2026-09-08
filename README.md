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

## Setup

```bash
cp .env.example .env    # fill in CODEX_API_KEY etc. .env is git-ignored.
pnpm install
```

Never commit secrets. `.env*`, `codex-home/`, and `runs/` are git-ignored.

## License

MIT
