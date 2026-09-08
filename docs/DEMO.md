# Demo — run of show (3:00)

Real numbers from run `20260908-210451-35b4` unless marked *(re-run)*. Two roles, never mixed: one **drives**
and never speaks; one **speaks** and never touches the keyboard.

## Before the room (T-60 min)

```bash
cd synthetic-playtest && pnpm install && pnpm game:build
pnpm orchestrator                                   # :4000, serves the game on :5273
cd apps/dashboard && pnpm build && pnpm start       # :3000
```

- Open http://localhost:3000 in a **1280×720** window. Personas pre-selected: maya, robert,
  sam, priya, dana. Do not touch sliders on stage.
- Second API key on a different account, one env var away. Check rate limits.
- Phone tether **primary**, venue wifi backup. Test the tether in that room.
- The fallback recording (`docs/demo-fallback.mp4` — record it the night before, full
  screen, same laptop) open in a second window, one keystroke away.
- **Cut rule: 20 seconds of stall → cut to the recording.** "Here's one from last night."
  No apology.

## 0:00 – 0:10 · Launch

Driver clicks **Launch**. Five panes appear, staggered starts 1.5s apart.

> "This is a 3D game none of these testers have seen. Five of them are about to play it —
> as five different people."

## 0:10 – 1:00 · Talk over the play

Panes fill with live feeds and one line of reasoning each. Speak; don't read the screen.

> "Studios pay human playtesters for weeks to learn one thing: not whether the game
> crashes — whether it *confuses* people, *bores* them, treats them *unfairly*. Every AI
> testing product today finds crashes. None find confusion.
>
> These five aren't prompts. Maya skims — long text is literally blurred out of her
> screenshots before the model sees them. Dana plays with the sound off — the listen tool
> does not exist for her. Robert has never used WASD in his life and nobody told him.
> The harness enforces who they are. That's why they behave differently."

## 1:00 – 1:30 · Stop talking. Expand one pane.

Driver expands **Robert** (or whichever pane shows a fresh finding). Read one line aloud,
verbatim, then be quiet for five seconds. Last run this was:

> *"How do I bend down?"* — high · confusion — "The duct said its opening was too low, but
> didn't show how to get lower. The instructions I'd read hadn't explained bending down."

> "That's the whole product. A 52-year-old who's never played a PC game, stuck on a
> control the game never taught. A crash-hunter cannot see that."

## 1:30 – 2:30 · Cut to the finished report

Driver opens the pre-baked hero report (Runs → last night's run → Open fleet report).

> "Last night, five testers, full budgets, **$33**. We built this game with 15 deliberate
> flaws and an answer key nobody else in this space has — so we can score ourselves.
>
> **Three of fifteen found. Zero false alarms. And one thing we didn't plant.**"

Point at the emergent finding:

> "Four of five testers stalled at the same four doors — locked, identical, and silent.
> Not in our ledger. The rule that caught it is ground truth, not the model's opinion:
> four testers stalled in the same room, at four different spots, on the same complaint.
> That's the game, not the agent. And it gated 80% of the content, which is *why* recall
> is 20% — the fleet found the blocker a hundred humans would have found in week one."

Point at Priya's B1:

> "The one who got through soft-locked — used a fuse in the wrong room, game unwinnable,
> no feedback. She wrote a bug report with repro steps, in character, and the game's own
> telemetry confirmed the soft-lock. We replayed her exact inputs at the same seed; it
> reproduced." *(3/3 reproduced on the follow-up session)*

*(re-run, if done)* > "We fixed the door and ran it again: recall went from 20% to __%."

## 2:30 – 3:00 · Analyst, then the ask

Driver clicks preset **1** — "What did all personas struggle with, and what did only some —
and why?" Let one paragraph render. Then:

> "Different buyer, different budget line: playtesting, not QA. Zero-shot on a game
> Astra has never seen, no SDK, no per-game training — that's ARC-AGI-3 as a product."

Stop. Under time reads as confidence.

## Q&A — measured answers

**"How do you know it's a bug and not your agent being bad?"** Three tiers, all from
telemetry the agent never sees: ≥4 of 5 stalled at the same spot; or the game itself
recorded a soft-lock; or ≥4 reported it and half of them stalled in that room. One tester
alone → we say so: "agent". Plus every finding with a signal is replay-verified.

**"What does a run cost?"** $0.06/step at 13 steps, $0.20/step at 115 — Codex keeps the
whole conversation. $33 for five personas; a deep completionist is a $20 line item. 92%
of input tokens are cached. We pre-approve the MCP server, which removes a hidden $0.66
reviewer session per run.

**"How is this different from modl.ai / nunu.ai / Razer?"** They find crashes. We find
confusion, boredom, unfairness — and we can prove recall against an answer key.

**"Do synthetic testers predict real players?"** We claim *discovery*, not prediction:
the dead ends and silent doors a hundred people would have hit in week one — before week
one.

**"Why Astra?"** Vision on a game it's never seen, 1M context for a session-long
narrative, and constrained competence — playing *badly in a specific, consistent way*
while still reasoning coherently is harder than playing well.
