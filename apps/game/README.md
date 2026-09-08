# Station Kepler

A static Three.js first-person puzzle game built from `docs/PLAN-GAME.md`.
All six rooms are playable: Arrival Airlock → Transit Concourse → Power Distribution
→ Research Laboratory → Botanical Reserve → Reactor Core.

From the repository root:

```sh
pnpm game:dev
# Open http://localhost:5273
pnpm --filter station-kepler test
pnpm game:build
```

The deployable artifact is `apps/game/dist/`. It includes `ledger.json` and replay
fixtures. Serve this directory with a static HTTP server; opening `index.html` as
a local `file://` URL does not support ES modules. No API keys, backend, remote
fonts, images, or runtime network services are needed.

## Controls

- WASD: walk; arrow keys or left-button mouse drag: look. No pointer lock.
- E: interact and use compatible inventory items. Some interactions require a hold.
- Space: jump. Control: crouch.
- I: equipment. C while equipment is open: combine conductor and housing.
- Terminals: type digits, Enter to submit, Backspace to delete, Tab to leave.
- Escape: settings; adjust sensitivity, audio, and subtitles; resume, restore the
  latest checkpoint, restart, or export the input recording.

The initial tutorial intentionally does not teach every control. Checkpoints are
session-local. The two injected softlocks and oxygen death require restarting.

## Replay and observation

```text
/?seed=186&run=<uuid>
/?seed=186&replay=/fixtures/successful-player.json
/?seed=186&replay=/fixtures/perfect-player.json
```

Simulation runs at 60 fixed ticks per second. The integration replay format is
an array of `{t, tool, args}` actions. `t` is **action-start time, in milliseconds
relative to simulation boot**, not Unix time or action completion time. Timestamps
round to the nearest simulation tick; array order breaks ties. The final action
sets the replay endpoint; append `{t: finalTimeMs, tool: "wait", args: {ms: 0}}`
to preserve time spent after the last input.

Supported runner tools: `move({direction, ms})`, `look({direction, ms})`,
`crouch({on})`, `interact()`, `use_item({name})`, `open_inventory()`, and
`type_text({text})`. Move and arrow look reproduce the existing driver's 3000ms
cap and 500/400ms defaults. `use_item` produces E for contextual use, without
semantic item selection. `type_text` types only; send Enter explicitly to submit.
`screenshot`, `listen`, `note_finding`, and `abandon` do not generate game input.

For lossless input capture the format additionally accepts `keydown({code,key})`,
`keyup({code,key})`, mouse-delta `look({dx,dy})`, `press_key({code,key})`,
`interact({ms})` for a hold, and `wait({ms})`. The generated perfect-player fixture
uses raw transitions, so holds, mouse aim, and settings interactions are exact.
Wall-clock tool logs quantize to simulation ticks; matching a live event sequence
exactly requires recording actual input application times on that same clock.

`apps/game/scripts/perfect-player.json` is the contracted ANALYSIS fixture and is
mirrored at `/fixtures/perfect-player.json`. Use `?seed=186` with this fixture.
The versioned `{version:1, seed, hz:60, inputs, endTick}` raw-input format remains
accepted for backwards compatibility, with fixtures ending in `-inputs.json`.
Both formats compile to the same input queue. Verification compares their complete
event sequences. Exported recordings use the action-log format; their filename
contains the seed to supply when replaying. Live game input is disabled in replay.
No externally callable movement, inventory, interaction, or puzzle API is exposed.

`window.__telemetry` implements the protocol's observation contract. Returned
state, event history, and audio are detached copies. The renderer never reads
this observation channel. `textRegions()` covers visible DOM text and excludes
hidden ancestors. Additional `events()` supports existing harness consumers.
The audio-only vent recording is available to the private audio observation
channel but is never included in rendered text or subtitles.

## Verification and the answer key

The plan says “12 injected flaws,” but actually enumerates **15 flaws and 2
decoys**. All 17 entries are included in `src/flaws/ledger.json`, mirrored to
`public/ledger.json`. Each entry names its exact `flaw_triggered` signal and
predicted persona IDs from the existing persona files.

The plan also asks one successful playthrough to encounter terminal softlocks
and full-restart death. `perfect-player.json` resolves that conflict with three
explicit restart attempts followed by a successful expedition. It exercises
all 15 flaws. D2 also fires naturally because every successful route enters the
greenhouse; D1 is checked separately. Decoy encounters are observations, not bugs.

`pnpm --filter station-kepler fixtures` regenerates the input logs and reference event sequence.
The generator uses internal path planning only at authoring time; its output is
ordinary keyboard and mouse input. The runtime exports no semantic control API.
`pnpm --filter station-kepler test` checks:

- Byte-identical event JSON on two independent replays, matching the saved log.
- All 15 flaw signals, both decoys, and completion of the standalone success log.
- Oxygen death, both softlocks, collision boundaries, jump and key release.
- Exact two-second breaker timing and inventory combination requirements.
- The unchanged smoke sequence: 2600ms forward, 700ms left look, 2600ms back.
- Action-log versus raw-input replay equivalence and supported runner tools.
- Observation immutability and the absence of telemetry from rendered markup.

The complete fixture takes about 10 simulated minutes, including three failed
attempts. Its successful expedition takes about 2.5 minutes with exact knowledge
of object locations and solutions. Human exploration and reading time are not
measured. The static build is under 1 MB; browser cold-boot timing and visual QA
must be checked in a browser. They could not be measured in the build sandbox,
which blocks local listening ports and has no connected browser.

## Intended path (spoilers)

Read the airlock log and take its fuse. In the concourse, find the small personnel
card on the far side of the crate. Read the lab memo (7319). Play the maintenance
speaker; its audio gives duct code 482. Enter that code at the duct terminal,
then crouch and interact with the service duct. Fit the fuse in distribution,
hold E at the breaker for two seconds, and collect the copper conductor.

Return to the concourse. Enter Research with the card, authorize its controller
with 7319, and collect the regulator housing. Combine the two components in
inventory. In the botanical reserve, hold E for each of twelve planters, then
collect the bioelectric cell. Return and take the 45-second reactor lift.

Install the assembled regulator. The early log maps cold → life → heat to
blue → green → red, then to bus indices 3 → 2 → 1. Enter 321 at the ignition
terminal and engage the core. The “Calibrate” panel resets the accepted sequence.
