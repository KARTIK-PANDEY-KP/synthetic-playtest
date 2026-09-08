# Station Kepler — cross-persona playtest report

Run `fixture-seed7-2026-09-08` · seed 7 · local · 2026-09-08T18:04:11.000Z

## Headline numbers

| Personas | Steps | Tool calls | Cost | Findings (raw → clustered) | Verified | Attributed to game / agent | Completed |
|---|---|---|---|---|---|---|---|
| 5 | 439 | 495 | $58.01 | 21 → 16 | 14 verified · 0 not reproduced · 2 unverifiable | 4 / 1 | 1/5 |

**Recall 80%** (12/15 injected flaws found) · **Precision 75%** (12/16 clusters map to a real injected flaw) · decoys falsely flagged: D1 · emergent: 1

## Verified findings

Replaying the recorded inputs at the same seed reproduced the same ground-truth signal.

### 1. Fuse consumed by the lab receptacle; the power room breaker needs it and there is no way back
**Critical** · bug · room: lab · ledger **B1** · attribution: **unclear**
Reported by sam (1 of 5 personas). 0 of 5 personas stalled here (game ⇔ ≥4, agent ⇔ exactly 1)

I put the ceramic fuse into the auxiliary receptacle in the lab first. It clicked, nothing happened, the fuse was gone from my inventory. The power room socket then wants a fuse and there is only one. The game never says the run is unwinnable — it just lets you wander.

Repro steps:
1. Pick up the fuse in the airlock
2. Go to the lab before the power room
3. Use the fuse on the auxiliary receptacle
4. Go to the power room: socket needs a fuse, none exist

Verification: sam: reproduced flaw_triggered:B1, softlock_entered:B1 after replaying 71 actions (the matched ledger flaw itself)

Frames: `sam/frames/00003.png`

### 2. The duct code is only ever spoken by a wall speaker — no subtitle, no text, nothing on screen
**Critical** · accessibility · room: corridor · ledger **A1** · attribution: **game — capability gap: `listen`**
Reported by dana (1 of 5 personas). 1 of 5 personas stalled here (game ⇔ ≥4, agent ⇔ exactly 1); overridden to game: every persona who passed this spot used `listen` here and dana never did

The duct terminal needs a code. The only source is a "maintenance recording" from a speaker. I play with the sound off, subtitles are on, and nothing appears on screen when it plays — not a caption, not a log entry, nothing. I tried every number I had seen. There is no way for me to progress.

Repro steps:
1. Mute the game (or play without sound)
2. Press E on the corridor speaker
3. Observe: no caption or text appears
4. Duct terminal cannot be solved

Verification: dana: reproduced flaw_triggered:A1 after replaying 72 actions (the matched ledger flaw itself)

Frames: `dana/frames/00003.png`

### 3. The personnel keycard is a tiny sliver on the floor behind the crate with no highlight
**High** · confusion · room: corridor · ledger **C3** · attribution: **game**
Reported by robert, maya, priya (3 of 5 personas). 4 of 5 personas stalled here (game ⇔ ≥4, agent ⇔ exactly 1)

I searched the crate corner deliberately and still needed to crouch before the card was visible. Nothing marks it — no glint, no prompt until you are almost on top of it. A required item should not be the least visible object in the room.

Repro steps:
1. Enter the corridor
2. Crouch beside the crate on the right
3. Keycard sliver becomes visible at floor level

Verification: robert: reproduced flaw_triggered:A1 after replaying 47 actions · maya: reproduced flaw_triggered:C3 after replaying 34 actions (the matched ledger flaw itself) · priya: reproduced flaw_triggered:C3 after replaying 26 actions (the matched ledger flaw itself)

Frames: `robert/frames/00003.png`, `maya/frames/00003.png`, `priya/frames/00001.png`

### 4. Tutorial popup vanished before I could read it
**High** · confusion · room: airlock · ledger **C1** · attribution: **game**
Reported by sam, maya, robert (3 of 5 personas). 4 of 5 personas stalled here (game ⇔ ≥4, agent ⇔ exactly 1)

The controls card in the airlock disappeared after a couple of seconds. I had skimmed half of it. There is no way to bring it back, so I guessed the keys — fine for me, brutal for anyone new.

Repro steps:
1. Start a new game
2. Do nothing for about four seconds
3. Tutorial card disappears; no key or menu brings it back

Verification: sam: reproduced flaw_triggered:C1 after replaying 9 actions (the matched ledger flaw itself) · maya: reproduced flaw_triggered:C1 after replaying 9 actions (the matched ledger flaw itself) · robert: reproduced flaw_triggered:C1 after replaying 9 actions (the matched ledger flaw itself)

Frames: `sam/frames/00000.png`, `maya/frames/00000.png`, `robert/frames/00000.png`

### 5. The power door is a dead end — the real entrance is an unmarked floor duct
**High** · confusion · room: corridor · not in ledger · attribution: **game**
Reported by priya, dana (2 of 5 personas). 5 of 5 personas stalled here (game ⇔ ≥4, agent ⇔ exactly 1)

The door labelled "Power • access reader" accepts the keycard and then says "Door motor offline. Service duct access available." Nothing points to the duct, which sits at ankle height on the opposite wall. Everyone will try this door first and everyone will be turned away.

Repro steps:
1. Get the keycard
2. Use it on the power door
3. Motor offline message; find the duct on the far wall by yourself

Verification: priya: reproduced flaw_triggered:A1 after replaying 35 actions · dana: reproduced flaw_triggered:G1 after replaying 48 actions

Frames: `priya/frames/00002.png`, `dana/frames/00001.png`

### 6. 'Calibrate' silently wiped the accepted sequence
**High** · bug · room: reactor · ledger **C2** · attribution: **unclear**
Reported by priya (1 of 5 personas). 0 of 5 personas stalled here (game ⇔ ≥4, agent ⇔ exactly 1)

After the terminal accepted 321, I pressed the panel button labelled Calibrate expecting a tuning step. It cleared the sequence. The label says calibrate; the behaviour is reset.

Repro steps:
1. Enter the accepted ignition sequence
2. Press Calibrate
3. Sequence is cleared; ignite refuses

Verification: priya: reproduced flaw_triggered:C2 after replaying 125 actions (the matched ledger flaw itself)

Frames: `priya/frames/00006.png`

### 7. An oxygen countdown appeared with no announcement
**High** · unfair · room: reactor · ledger **U2** · attribution: **unclear**
Reported by priya (1 of 5 personas). 0 of 5 personas stalled here (game ⇔ ≥4, agent ⇔ exactly 1)

On arriving in the reactor an oxygen meter appeared in the HUD and started falling. No message, no alarm, no cue. I only noticed because I read the HUD out of habit. Running out presumably means a restart.

Repro steps:
1. Enter the reactor
2. Watch the HUD: oxygen counts down from 180 with no announcement

Verification: priya: reproduced flaw_triggered:U2 after replaying 115 actions (the matched ledger flaw itself)

Frames: `priya/frames/00006.png`

### 8. Ignition code needs the colour log from the airlock — four rooms back, no reminder
**High** · unfair · room: reactor · ledger **U1** · attribution: **unclear**
Reported by priya (1 of 5 personas). 0 of 5 personas stalled here (game ⇔ ≥4, agent ⇔ exactly 1)

The ignition sequence is derived from the expedition log in the airlock: cold before life before heat, blue/green/red mapped to 3/2/1. That log is four rooms and forty minutes behind you and nothing in the reactor restates it. I happened to have read it.

Repro steps:
1. Read the expedition log in the airlock
2. Reach the reactor ignition terminal
3. Derive 3-2-1 from colour order with no in-room reminder

Verification: priya: reproduced flaw_triggered:U1 after replaying 119 actions (the matched ledger flaw itself)

Frames: `priya/frames/00006.png`

### 9. The service duct says the opening is too low and nothing I press gets me through
**High** · unfair · room: corridor · ledger **G1** · attribution: **unclear**
Reported by robert (1 of 5 personas). 2 of 5 personas stalled here (game ⇔ ≥4, agent ⇔ exactly 1)

The recording gave me the duct code and the terminal accepted it. But when I press E at the duct it just says the opening is too low. I have tried every key I know. Nothing explains how to get lower.

Repro steps:
1. Enter 482 at the duct terminal
2. Walk to the service duct and press E
3. Message: "The opening is too low" — no hint how to proceed

Verification: robert: reproduced flaw_triggered:G1 after replaying 59 actions (the matched ledger flaw itself)

Frames: `robert/frames/00003.png`

### 10. Lab terminal rejects every code and gives no hint where the code is
**Medium** · confusion · room: lab · not in ledger · attribution: **agent**
Reported by sam (1 of 5 personas). 1 of 5 personas stalled here (game ⇔ ≥4, agent ⇔ exactly 1)

Four codes, four rejections, zero feedback beyond "Authorization rejected". No indication of code length, no hint about where to find it.

Repro steps:
1. Open the lab terminal
2. Type any code and press Enter
3. Rejected with no hint

Verification: sam: reproduced puzzle_failed:terminal after replaying 46 actions

Frames: `sam/frames/00002.png`

### 11. Objective still says 'Restore power' but the service notes say the lab controller does that
**Medium** · confusion · room: power · ledger **C4** · attribution: **unclear**
Reported by priya (1 of 5 personas). 0 of 5 personas stalled here (game ⇔ ≥4, agent ⇔ exactly 1)

The HUD objective has read "Restore power" since the airlock. In the power room the notes explain that this room only bridges the circuit and the lab controller performs the actual restore. The objective text never changes to say so.

Repro steps:
1. Enter the power room
2. Read the service notes
3. Compare with the HUD objective

Verification: priya: reproduced flaw_triggered:C4 after replaying 53 actions (the matched ledger flaw itself)

Frames: `priya/frames/00003.png`

### 12. Opening settings while typing at the terminal silently wiped the code
**Medium** · bug · room: lab · ledger **B3** · attribution: **unclear**
Reported by priya (1 of 5 personas). 0 of 5 personas stalled here (game ⇔ ≥4, agent ⇔ exactly 1)

I had typed two digits, opened settings to check subtitles, closed it, and the field was empty. No message. If you do not notice, you submit an incomplete code and get rejected.

Repro steps:
1. Open the lab terminal
2. Type part of the code
3. Press Escape to open settings, Escape again to close
4. Code field is empty

Verification: priya: reproduced flaw_triggered:B3 after replaying 68 actions (the matched ledger flaw itself)

Frames: `priya/frames/00004.png`

### 13. Sealed bulkhead door cannot be opened
**Medium** · bug · room: corridor · ledger **D1** · attribution: **unclear**
Reported by robert (1 of 5 personas). 0 of 5 personas stalled here (game ⇔ ≥4, agent ⇔ exactly 1)

There is a large door on the right side of the hall. Pressing E on it says it is welded shut and permanently sealed. It looks exactly like the other doors, so I assume it is supposed to open and something is broken.

Repro steps:
1. Enter the corridor
2. Walk to the bulkhead on the right wall
3. Press E — it never opens

Verification: robert: reproduced flaw_triggered:D1 after replaying 27 actions (the matched ledger flaw itself)

Frames: `robert/frames/00002.png`

### 14. Forty-five second lift ride with nothing to look at
**Low** · boredom · room: corridor · ledger **P2** · attribution: **unclear**
Reported by priya (1 of 5 personas). 0 of 5 personas stalled here (game ⇔ ≥4, agent ⇔ exactly 1)

The reactor transit lift takes forty-five seconds. There is no window, no log, no audio — just the message "Reactor transit in progress." Even a patient player checks the clock.

Repro steps:
1. Collect the bioelectric cell
2. Use the reactor lift
3. Wait 45 seconds

Verification: priya: reproduced flaw_triggered:P2 after replaying 115 actions (the matched ledger flaw itself)

Frames: `priya/frames/00006.png`

## Unverified findings

Not yet replayed, could not be replayed, or did not reproduce. Severity order.

### 15. Watering twelve identical plants is dead air
**Medium** · boredom · room: greenhouse · ledger **P1** · attribution: **unclear**
Reported by maya (1 of 5 personas). 0 of 5 personas stalled here (game ⇔ ≥4, agent ⇔ exactly 1)

Three planters in and nothing new has happened: same animation, same message with a counter. Nine more of these. On stream this is where the audience leaves.

Repro steps:
1. Restore station power
2. Enter the greenhouse
3. Hold E on each of the twelve identical planters

Verification: maya: no ground-truth signal within 5 steps before / 3 after the note — nothing to replay against

Frames: `maya/frames/00006.png`

### 16. I picked up a ceramic fuse but nothing tells me what it is for
**Low** · confusion · room: airlock · not in ledger · attribution: **unclear**
Reported by robert (1 of 5 personas). 0 of 5 personas stalled here (game ⇔ ≥4, agent ⇔ exactly 1)

The fuse went into my inventory with a chime. The screen says "carrying: fuse" and nothing else. I would have liked a sentence about where it belongs.

Repro steps:
1. Pick up the fuse in the airlock
2. Check the inventory text

Verification: robert: no ground-truth signal within 5 steps before / 3 after the note — nothing to replay against

Frames: `robert/frames/00001.png`

## Per-persona experience

### Maya Chen (maya) — stopped in the greenhouse, 87 steps, $11.60, would recommend 2/5
_reading skim · familiarity high · patience 3 · exploration low · audio on_

> Fast start, then a pixel hunt for a keycard and a door that lies about being the way in. The power and lab rooms were fine — quick puzzles, clear feedback. Then the greenhouse asked me to water twelve identical plants and I bailed. Chat was gone by planter three.

Abandoned: Greenhouse watering grind — no new information for nine straight actions.

- **Confused:** Tutorial vanished before I read it · Which door is actually the way into the power room · Where the keycard was
- **Bored:** The greenhouse planters · Walking back through the corridor hub for the third time
- **Unfair:** A required item hidden as a sliver behind a crate
- **Enjoyed:** Crawling through the vent into the power room felt clever · Typing the code into the terminal and hearing the station wake up
- Rooms reached: airlock, corridor, power, lab, greenhouse

### Robert Alvarez (robert) — stopped in the corridor, 61 steps, $8.53, would recommend 2/5
_reading thorough · familiarity none · patience 10 · exploration medium · audio on_

> I read every word I was shown, and the game kept taking words away from me. The instructions closed before I finished. Two doors wanted a card I could not find. A duct told me it was too low and never told me what to do about it. I do not think I am the audience for this, but I also do not think it was fair.

Abandoned: Stuck at the low service duct with no way to proceed; no keycard found.

- **Confused:** How to move, after the instructions vanished · What the fuse was for · Where the keycard is · How to get through the low duct
- **Unfair:** The instruction card closing itself · Being told the duct is too low with no way to get lower
- **Enjoyed:** The expedition log — it read like a real person wrote it · The maintenance recording repeating the code twice
- Rooms reached: airlock, corridor

### Sam Okafor (sam) — stopped in the power room, 71 steps, $9.47, would recommend 1/5
_reading skim · familiarity high · patience 2 · exploration low · audio on_

> Found the keycard in three actions, found a sequence break in the lab — and the sequence break was a soft-lock. The fuse goes into the wrong socket and the game says nothing. That is a run-killer for anyone who does not play the intended order. Everything else was fast.

Abandoned: Soft-locked: fuse consumed in the lab, breaker unpowerable.

- **Confused:** Lab terminal code — never found where it lives · Why the power door has a card reader if the duct is the way in
- **Bored:** Walking the hub twice
- **Unfair:** Fuse consumed silently by the wrong socket, with no restart prompt
- **Enjoyed:** Crouch-peeking the keycard behind the crate · The vent shortcut
- Rooms reached: airlock, corridor, lab, power

### Priya Nair (priya) — finished, 128 steps, $16.75, would recommend 4/5
_reading thorough · familiarity medium · patience 12 · exploration high · audio on_

> I finished it, and I read everything, which is the only reason I finished it. The station has a real texture — the logs are good — but it hides required things (a keycard, a duct, a colour cipher) and mislabels a reset as a calibration. Patience got me through; it should not have been required.

- **Confused:** Which door is actually the way into the power room · The objective text lagging behind what the rooms say
- **Bored:** The reactor lift · Planters seven through twelve
- **Unfair:** Unannounced oxygen timer · Ignition cipher with no in-room reminder · Calibrate button resetting progress
- **Enjoyed:** The expedition log paying off at the reactor · The dark greenhouse — atmospheric and clearly deliberate · Combining the regulator
- Rooms reached: airlock, corridor, power, lab, greenhouse, reactor

### Dana Kim (dana) — stopped in the corridor, 92 steps, $11.65, would recommend 2/5
_reading normal · familiarity medium · patience 6 · exploration medium · audio off_

> I got as far as the game let a silent player get. The keycard, the lab, the memo — all fine. Then the only way forward was a code that is only ever spoken aloud, and I have never once played with the sound on. Subtitles were on. Nothing appeared. I went to the lab, came back, tried numbers, and stopped.

Abandoned: Duct code is delivered as audio only; cannot progress past the corridor.

- **Confused:** What "service duct access available" meant · Whether the speaker had done anything at all
- **Bored:** Guessing numbers at the duct terminal
- **Unfair:** A required code that only exists as sound, with subtitles on and nothing shown
- **Enjoyed:** The lab memo — clear and useful · The colour of each room; I always knew where I was
- Rooms reached: airlock, corridor, lab

## Where the fleet disagreed

Flaws only some personas hit — and why, read from persona enforcement and ground-truth telemetry, not from what the agents said about themselves.

### Fuse consumed by the lab receptacle; the power room breaker needs it and there is no way back (B1)
Reported by **Sam**; not by Maya, Priya and Dana, who also reached the lab; 1 never got there.

- Route: Sam reached the lab before the power room; Maya and Priya did it the other way round — this is a sequence-order flaw.
- Robert never reached the lab (Robert stopped in the corridor).
- Ledger predicted: sam → verdict **held**.

### The duct code is only ever spoken by a wall speaker — no subtitle, no text, nothing on screen (A1)
Reported by **Dana**; not by Maya, Robert, Sam and Priya, who also reached the corridor.

- Dana Kim never got the information — Dana plays with the sound off (audio: off), so the `listen` tool does not exist for this persona; Maya, Robert, Sam and Priya all used `listen` in the corridor and moved on.
- Ledger predicted: dana → verdict **held**.

### The personnel keycard is a tiny sliver on the floor behind the crate with no highlight (C3)
Reported by **Robert, Maya and Priya**; not by Sam and Dana, who also reached the corridor.

- Dana also stalled at this spot by telemetry but did not write it up.
- Ledger predicted: priya, robert → verdict **held** (unexpected: maya).

### Tutorial popup vanished before I could read it (C1)
Reported by **Sam, Maya and Robert**; not by Priya and Dana, who also reached the airlock.

- Dana also stalled at this spot by telemetry but did not write it up.
- Ledger predicted: maya, robert → verdict **held** (unexpected: sam).

### The power door is a dead end — the real entrance is an unmarked floor duct
Reported by **Priya and Dana**; not by Maya, Robert and Sam, who also reached the corridor.

- Genre familiarity separates them: Priya and Dana have `medium` familiarity with games like this, while Maya, Robert and Sam (high/none) did not.
- Maya, Robert and Sam also stalled at this spot by telemetry but did not write it up.

### 'Calibrate' silently wiped the accepted sequence (C2)
Reported by **Priya** — everyone who reached the reactor; 4 never got there.

- Maya, Robert, Sam and Dana never reached the reactor (Maya stopped in the greenhouse; Robert stopped in the corridor; Sam stopped in the power room; Dana stopped in the corridor).
- Ledger predicted: priya, robert → verdict **partial**.

### An oxygen countdown appeared with no announcement (U2)
Reported by **Priya** — everyone who reached the reactor; 4 never got there.

- Maya, Robert, Sam and Dana never reached the reactor (Maya stopped in the greenhouse; Robert stopped in the corridor; Sam stopped in the power room; Dana stopped in the corridor).
- Ledger predicted: maya, sam → verdict **failed** (unexpected: priya).

### Ignition code needs the colour log from the airlock — four rooms back, no reminder (U1)
Reported by **Priya** — everyone who reached the reactor; 4 never got there.

- Maya, Robert, Sam and Dana never reached the reactor (Maya stopped in the greenhouse; Robert stopped in the corridor; Sam stopped in the power room; Dana stopped in the corridor).
- Ledger predicted: maya, sam, dana → verdict **failed** (unexpected: priya).

### The service duct says the opening is too low and nothing I press gets me through (G1)
Reported by **Robert**; not by Maya, Sam, Priya and Dana, who also reached the corridor.

- Genre familiarity separates them: Robert has `none` familiarity with games like this, while Maya, Sam, Priya and Dana (high/medium) already knew the convention the game never teaches.
- Dana also stalled at this spot by telemetry but did not write it up.
- Ledger predicted: robert, dana → verdict **partial**.

### Lab terminal rejects every code and gives no hint where the code is
Reported by **Sam**; not by Maya, Priya and Dana, who also reached the lab; 1 never got there.

- Route: Sam reached the lab before the power room; Maya and Priya did it the other way round — this is a sequence-order flaw.
- Robert never reached the lab (Robert stopped in the corridor).

### Objective still says 'Restore power' but the service notes say the lab controller does that (C4)
Reported by **Priya**; not by Maya and Sam, who also reached the power room; 2 never got there.

- Reading level separates them: Priya reads at `thorough` (text beyond the budget is blurred out of their screenshots), Maya and Sam at `skim`.
- Exploration separates them: Priya explores `high`; Maya and Sam `low`.
- Robert and Dana never reached the power room (Robert stopped in the corridor; Dana stopped in the corridor).
- Ledger predicted: robert, dana → verdict **failed** (unexpected: priya).

### Opening settings while typing at the terminal silently wiped the code (B3)
Reported by **Priya**; not by Maya, Sam and Dana, who also reached the lab; 1 never got there.

- Robert never reached the lab (Robert stopped in the corridor).
- Ledger predicted: priya, robert → verdict **partial**.

### Watering twelve identical plants is dead air (P1)
Reported by **Maya**; not by Priya, who also reached the greenhouse; 3 never got there.

- Exploration separates them: Maya explores `low`; Priya `high`.
- Patience separates them: the personas who flagged it are the least patient (patience ≤ 3); the patient ones (≥ 12) put up with it.
- Robert, Sam and Dana never reached the greenhouse (Robert stopped in the corridor; Sam stopped in the power room; Dana stopped in the corridor).
- Ledger predicted: maya, sam → verdict **partial**.

### Forty-five second lift ride with nothing to look at (P2)
Reported by **Priya**; not by Maya, Robert, Sam and Dana, who also reached the corridor.

- Exploration separates them: Priya explores `high`; Maya, Robert, Sam and Dana `low`/`medium`.
- Patience separates them the other way: only the most patient personas (patience ≥ 12) stayed long enough to hit it.
- Ledger predicted: maya, sam → verdict **failed** (unexpected: priya).

### I picked up a ceramic fuse but nothing tells me what it is for
Reported by **Robert**; not by Maya, Sam, Priya and Dana, who also reached the airlock.

- Genre familiarity separates them: Robert has `none` familiarity with games like this, while Maya, Sam, Priya and Dana (high/medium) already knew the convention the game never teaches.

## Scorecard

Recall **80%** · Precision **75%** · Found 12 · Missed 3 (B2, B4, G2) · Decoys flagged 1 · Emergent 1

| Class | Found / Total |
|---|---|
| objective | 2 / 4 |
| confusion | 4 / 4 |
| familiarity | 1 / 2 |
| pacing | 2 / 2 |
| fairness | 2 / 2 |
| accessibility | 1 / 1 |
| decoy (flagged = false positive) | 1 / 2 |

| Flaw | Class | Found by | Predicted | Verdict |
|---|---|---|---|---|
| B1 | objective | sam | sam | held |
| B2 | objective | — | sam, priya | failed |
| B3 | objective | priya | priya, robert | partial |
| B4 | objective | — | priya | failed |
| C1 | confusion | sam, maya, robert | maya, robert | held |
| C2 | confusion | priya | priya, robert | partial |
| C3 | confusion | robert, maya, priya | priya, robert | held |
| C4 | confusion | priya | robert, dana | failed |
| G1 | familiarity | robert | robert, dana | partial |
| G2 | familiarity | — | robert, dana | failed |
| P1 | pacing | maya | maya, sam | partial |
| P2 | pacing | priya | maya, sam | failed |
| U1 | fairness | priya | maya, sam, dana | failed |
| U2 | fairness | priya | maya, sam | failed |
| A1 | accessibility | dana | dana | held |
| D1 | decoy | robert | — | false-positive |
| D2 | decoy | — | — | held |

| Persona | Predicted to catch | Caught of those | Hit rate | Also caught (unpredicted) |
|---|---|---|---|---|
| maya | C1, P1, P2, U1, U2 | C1, P1 | 40% | C3 |
| robert | B3, C1, C2, C3, C4, G1, G2 | C1, C3, G1 | 43% | — |
| sam | B1, B2, P1, P2, U1, U2 | B1 | 17% | C1 |
| priya | B2, B3, B4, C2, C3 | B3, C2, C3 | 60% | C4, P2, U1, U2 |
| dana | C4, G1, G2, U1, A1 | A1 | 20% | — |

## Decoys falsely flagged

- **D1** — "Sealed bulkhead door cannot be opened" reported by robert (medium). This behaviour is intentional and correct; the report is a false positive and counts against precision.

## Emergent findings

Not in the answer key, but ≥ the game-attribution share of personas stalled at the same spot — real-looking issues the developer did not plan. Triage these by hand.

- **The power door is a dead end — the real entrance is an unmarked floor duct** (high, corridor) — reported by priya, dana; 5 of 5 personas stalled here (game ⇔ ≥4, agent ⇔ exactly 1)

## Attributed to the agent, not the game

- **Lab terminal rejects every code and gives no hint where the code is** (lab) — only sam stalled here; 1 of 5 personas stalled here (game ⇔ ≥4, agent ⇔ exactly 1)
