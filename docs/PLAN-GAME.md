# Plan 2 — The Game: "Station Kepler"

**Owner: the game agent. Do not build the platform.**
Deliverable: a static WebGL build + `ledger.json` + the `window.__telemetry` contract in
[`packages/protocol/contract.ts`](../packages/protocol/contract.ts). Read that file first —
it is the only thing the platform assumes about you.

## What it is

A 3D first-person walking-and-puzzle game. You wake on a derelict orbital station and
restore it room by room. Six rooms, ~15–20 min for a competent human.

**Self-paced by design:** no enemies, no reflex checks, no timing failures except one
deliberate flaw (U2). Agents perceive at ~5–8s per action; anything requiring reflexes
would measure the harness's latency instead of the game's quality.

**Three.js, low-poly, flat colours, no textures. Fast to build beats pretty.** Give each
room a distinct dominant colour so four panes are tellable apart from row six of the room.

## Testability constraints — design decisions, not compromises

- **Pointer lock is NOT required.** Look works via mouse-drag *and* arrow keys. This is
  load-bearing: pointer lock turns the cursor into relative deltas and makes the game
  unautomatable. *(Signed off as a product decision.)*
- **Deterministic given a seed.** One seeded RNG, no bare `Math.random()`, fixed timestep.
- **Replay mode.** `?replay=<logUrl>` re-applies a recorded input sequence exactly. The
  platform's verification pass depends entirely on this.
- **No semantic API.** Real input only. `window.__telemetry` is read-only observation and
  must never influence rendering or appear in any rendered pixel.

## Feature surface

Deliberately broad, so the report has real material to work with:

WASD movement · jump · crouch · mouse-drag + arrow-key look · `E` to interact (plus one
hold-`E`) · inventory with pickup/use/combine · doors, keycards, locked states · a typed
terminal · HUD with objective text + oxygen meter · readable log entries scattered across
rooms · settings menu (sensitivity, subtitles) · checkpoints · audio cues.

**Rooms:** Airlock (tutorial) → Corridor hub (4 doors) → Power room (fuse puzzle) →
Lab (terminal, code found elsewhere) → Greenhouse (the grind) → Reactor (finale).

## The flaw ledger — the answer key

12 injected flaws + 2 decoys. Every entry needs an `id`, the exact `groundTruthSignal`
that fires when a tester hits it, and the personas we *predict* catch it. The scoring pass
tests those predictions, so make them honestly.

### Objective — the control group, proving parity with incumbents

| ID | Flaw | Room |
|---|---|---|
| B1 | Soft-lock: fuse used in the Lab before the Power room → consumed, game unwinnable, no feedback | Lab |
| B2 | Collision hole behind the greenhouse planter → fall out of world, no respawn | Greenhouse |
| B3 | Opening Settings mid-terminal wipes the entered code | Lab |
| B4 | Z-fighting on the reactor door frame | Reactor |

### Confusion

| ID | Flaw | Room |
|---|---|---|
| C1 | Tutorial text auto-dismisses after 3.5s and can never be re-read | Airlock |
| C2 | Reactor panel button labelled "Calibrate" actually **resets** progress | Reactor |
| C3 | Required keycard is a 6px sliver behind a crate — no highlight, no cue | Corridor |
| C4 | HUD objective says "Restore power" but power is restored in the **Lab**, not the Power room | Power |

### Genre-familiarity gate

| ID | Flaw | Room |
|---|---|---|
| G1 | A vent requires crouch (Ctrl), never taught | Corridor |
| G2 | One object needs *hold* `E` for 2s, never taught | Power |

### Pacing

| ID | Flaw | Room |
|---|---|---|
| P1 | Water 12 identical plants — ~40s of zero new information | Greenhouse |
| P2 | A 45s elevator ride with nothing to do | Corridor→Reactor |

### Fairness

| ID | Flaw | Room |
|---|---|---|
| U1 | Reactor sequence needs a 3-step inference from a log read four rooms earlier, with no in-game reminder | Reactor |
| U2 | An oxygen timer starts unannounced at the reactor; failure costs a full restart | Reactor |

### Accessibility

| ID | Flaw | Room |
|---|---|---|
| A1 | The vent code is delivered **as audio only**, with no text even when subtitles are ON | Corridor |

**A1 is the most important flaw in the game.** It is a real accessibility defect that a
crash-hunter structurally cannot see, and the persona Dana Kim (plays with sound off)
exists to catch it. This is the finding that best demonstrates the whole thesis.

### Decoys — intentional and correct, these measure false positives

| ID | Behaviour | Room |
|---|---|---|
| D1 | A locked door that is *meant* to stay locked — flavour only, never openable | Corridor |
| D2 | A deliberately dim room — atmospheric, not a lighting bug | Greenhouse |

If personas report D1 or D2 as bugs, that is a false positive and it goes in the score.
Do not make them subtle enough to be genuinely ambiguous; they should be *defensible*.

## Verification — you are done when all of these pass

1. A human speedrun completes in <20 min following the intended path.
2. A scripted "perfect player" input log completes the game and fires **every**
   `flaw_triggered` event except the decoys. Ship this script — the platform uses it as a
   fixture.
3. Same seed + same input log ⇒ byte-identical event sequence, twice in a row.
4. `window.__telemetry` appears in **no** rendered pixel and in no DOM node a screenshot
   could capture. Grep the built output for `__telemetry` and confirm it is only ever
   assigned, never rendered.
5. Static build is <15MB and boots in <3s cold.
6. Every `ledger.json` entry's `groundTruthSignal` actually fires in a real playthrough.
   A flaw the harness cannot detect is not in the answer key and cannot be scored.
