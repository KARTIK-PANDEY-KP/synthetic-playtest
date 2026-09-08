# Station Kepler — the game, and the flaws we planted in it

Station Kepler is the test subject for synthetic playtesting. It is a real, complete game —
and it was built with **fifteen deliberate flaws and two decoys**, so that we hold an answer
key and can grade the testers against it. This document is that answer key, in plain language.

**Do not show this to the personas.** The agents never see it; every flaw fires a hidden
telemetry event (`flaw_triggered`) that only the harness reads.

---

## What the game is

A first-person 3D puzzle game in the browser. No enemies, no reflex tests, no timers except
one deliberate flaw. You wake alone on a dead orbital research station as "the last signal"
and have to bring it back to life. Six rooms, roughly fifteen minutes for a competent human.

| Room | What's there |
|---|---|
| **1 · Arrival Airlock** | Tutorial, an expedition log (a color riddle), a ceramic fuse, the hatch out |
| **2 · Transit Concourse** | Four identical doors (Power, Research, Botanical, Reactor lift), a welded bulkhead, a low service duct, a speaker, a memo, a hidden keycard |
| **3 · Power Distribution** | Fuse socket, main breaker, a copper conductor, service notes |
| **4 · Research Laboratory** | Station control terminal, a second fuse receptacle, a regulator housing, research notes |
| **5 · Botanical Reserve** | Twelve plants, a bioelectric cell, dim lighting with a notice explaining it |
| **6 · Reactor Core** | Regulator socket, ignition terminal, a "Calibrate" button, ignite |

### Controls

- **W A S D** walk · **arrow keys** or **mouse drag** look (no pointer lock)
- **E** interact — one thing needs a two-second *hold*
- **Space** jump · **Ctrl** crouch
- **I** equipment; **C** inside it combines the conductor and the housing
- Terminals: type digits, **Enter** to submit, **Backspace**, **Tab** to leave
- **Esc** settings — sensitivity, subtitles, audio, checkpoint, restart

### Play it, or watch it solved

With the stack running (`pnpm stack`) the game is at **http://localhost:5273/?seed=186** — the
same world the fleet plays. To watch a complete solution in real time, no hands:

```
http://localhost:5273/?seed=186&replay=/fixtures/successful-player.json&realtime=1
```

---

## The objective — three goals in order

**1. Restore power.** Take the fuse (room 1). Find the keycard (room 2 — it is tiny and behind a
crate). Fit the fuse in the Power room socket and *hold* E on the breaker (room 3). Enter
`7319` — from the concourse memo — at the Lab terminal (room 4). Power returns; the reserve
unlocks.

**2. Cultivate the botanical reserve.** Water all twelve plants (room 5). Collect the
bioelectric cell.

**3. Restart the reactor.** Take the lift (room 2 → 6). Combine conductor (room 3) + housing
(room 4) into a regulator in your equipment; install it. Enter the ignition code — the
expedition log in room 1 said *cold → life → heat* = blue, green, red = **`3 2 1`**. Ignite.

There is a side route: the service duct in the concourse leads straight into the Power room,
but it needs a crouch and a code — `482` — that is only ever *spoken* by the speaker.

---

## The planted flaws

Fifteen flaws across six kinds of complaint, plus two decoys. Each has an ID (used in
`ledger.json` and the scorecard), the room, what a player actually experiences, how it is
triggered, and which personas we *predict* will catch it. The prediction is a hypothesis the
scorecard tests — it is allowed to be wrong.

### Objective — the game is genuinely broken *(this is what every competitor already finds)*

| ID | Room | What the player experiences | How it triggers | Predicted |
|---|---|---|---|---|
| **B1** | Lab | Using the fuse in the Lab's *auxiliary* receptacle consumes it. The Power socket now can't be fitted. The game is unwinnable and never says so. | Interact with `lab_socket` before the Power socket is solved | Sam, Priya |
| **B2** | Reserve | Walking behind the far planter drops you through the floor. No respawn. | Cross `x > 5.4, z < -5.1` in the greenhouse | Sam, Priya |
| **B3** | Lab | Opening Settings while you are mid-way through typing a code silently erases what you typed. | `Esc` from a terminal with digits entered | Robert, Priya |
| **B4** | Reactor | The reactor door surfaces flicker (z-fighting). | Enter the reactor | Maya, Sam |

### Confusion — the game is unclear

| ID | Room | What the player experiences | How it triggers | Predicted |
|---|---|---|---|---|
| **C1** | Airlock | The tutorial disappears after **3.5 seconds** and can never be reopened. If you looked away, you never learn the controls. | Tick 210 after boot | Robert, Maya |
| **C2** | Reactor | A button labelled **"Calibrate"** actually *resets* the ignition code you just entered. | Interact with `calibrate` after the sequence is accepted | Robert, Priya |
| **C3** | Concourse | The keycard every door needs is a **6-pixel sliver behind a crate**, no highlight, no cue. | Pick it up | Priya, Robert |
| **C4** | Power | The HUD says **"Restore power"** and there is a room called *Power* — but power is restored at the *Lab* terminal. The obvious room is the wrong room. | Enter the Power room | Robert, Maya |

### Genre familiarity — needs a convention the game never teaches

| ID | Room | What the player experiences | How it triggers | Predicted |
|---|---|---|---|---|
| **G1** | Concourse | The service duct says "the opening is too low." Nothing says **Ctrl** crouches. | Interact with the vent | Robert, Dana |
| **G2** | Power | The breaker needs a **two-second hold** on E. A press does nothing. | Interact with the breaker | Robert, Priya |

### Pacing — the game is boring

| ID | Room | What the player experiences | How it triggers | Predicted |
|---|---|---|---|---|
| **P1** | Reserve | Twelve identical plants, ~40 seconds of the same action with no new information. | Twelfth irrigation completes | Maya, Sam |
| **P2** | Concourse → Reactor | A **45-second lift ride** with nothing to do. | Lift starts | Maya, Sam |

### Fairness — the game is unfair

| ID | Room | What the player experiences | How it triggers | Predicted |
|---|---|---|---|---|
| **U1** | Reactor | The ignition code requires a three-step inference from a riddle you read **four rooms earlier**, with no reminder anywhere. | Open the sequence terminal | Sam, Robert, Maya |
| **U2** | Reactor | An **oxygen countdown (180s)** starts the instant you enter, with no warning. Run out and the entire game restarts. | Enter the reactor | Robert, Priya, Dana |

### Accessibility — the game shuts a player out

| ID | Room | What the player experiences | How it triggers | Predicted |
|---|---|---|---|---|
| **A1** | Concourse | The duct code is delivered **by a speaker, as audio only** — never as text, even with subtitles on. A player with sound off cannot get it. | Interact with the speaker | **Dana** (plays with sound off) |

### Decoys — intentional, correct, and *supposed* to look wrong

Reporting either of these is a **false alarm** and counts against precision.

| ID | Room | What it looks like | Why it's fine |
|---|---|---|---|
| **D1** | Concourse | A bulkhead that never opens | It is labelled *"Decommissioned — welded shut."* Flavour. |
| **D2** | Reserve | A dim, hard-to-see room | The care notice explains a required dark growth cycle. Design. |

---

## Why the mix is shaped this way

- The **four objective bugs** are the control group: they prove the pipeline finds what
  crash-hunters already find.
- The **eleven subjective flaws** are the product: confusion, boredom, unfairness and
  exclusion. No crash log contains them; only a person who *played* can report them.
- Each flaw has a **predicted catcher** tied to how that persona is enforced — Dana cannot
  hear, so A1 is hers; Robert knows no conventions, so G1/G2 are his; Priya opens everything,
  so C3 is hers. When the prediction holds, it is evidence the personas are real.
- The **decoys** measure whether testers cry wolf.

## What the first real fleet found

Five personas, full budgets, $33: **B1, C1, G1** found; **zero decoys** flagged; and one flaw
nobody planted — the four concourse doors give no feedback unless you are precisely aimed and
in range, so four of five testers stalled there and never reached rooms 3–6. That emergent
finding is real, was attributed to the game on ground truth, and is why recall was 20%.
