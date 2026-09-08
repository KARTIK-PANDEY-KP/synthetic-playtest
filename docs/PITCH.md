# Pitch — Synthetic Playtesting

Spoken script, ~4 minutes with the demo woven in. Real numbers from run `20260908-210451-35b4`.
Two roles: one **speaks**, one **drives**. The driver never talks; the speaker never touches the keyboard.

---

## 0:00 — The problem (30s)

> Every game you've ever loved was tested by people. Not just QA looking for crashes — **beta
> testers and early-access players**, hundreds of them, playing the way real people play:
> skimming the tutorial, getting lost, getting bored, rage-quitting at a door. Studios pay for
> that in weeks and real money, and it's the only way to learn whether a game is *confusing*,
> not just whether it's *broken*.
>
> That was fine when a studio shipped a game every three years. It is not fine now. AI is
> about to make games at a pace no beta program can keep up with — more titles, more builds,
> more iterations per day than there are humans to play them. **The bottleneck in game
> production is about to be testing.**

## 0:30 — Why now: the voice-AI parallel (35s)

> We've seen this exact problem solved once already — in **voice AI**. Nobody QAs a voice
> agent by hand anymore. You write *personas* — the impatient caller, the confused senior,
> the one who mumbles — and you let them hammer the agent thousands of times. Persona-driven
> testing is how that whole industry ships.
>
> Games never got that, for one reason: **no model could actually play a game it had never
> seen.** Until Astra. Astra saturates ARC-AGI-3 — the benchmark that is literally "understand
> a novel interactive environment with no instructions" — and it can look at a screen and act
> on it. That capability unlocks the same trick for games. So we built it.

## 1:05 — What it is (25s)

> **Synthetic playtesting.** You describe beta testers as *people* — Maya, a streamer who
> skims everything; Robert, fifty-two, first PC game ever; Dana, who plays with the sound off.
> Each one gets their own cloud sandbox with a browser and an Astra agent, and they play the
> game the way *that person* would. Not because we asked nicely in a prompt — the harness
> **enforces** it. Maya's screenshots have the long text blurred out before the model sees
> them. Dana doesn't have a "listen" tool at all. That's what makes them testers instead of
> assistants.
>
> When they're done, you get what a beta program gives you: reports, in their own voice,
> deduplicated across testers, with repro steps that we replay to verify.

## 1:30 — Demo, part 1: launch and watch (45s)

**Driver:** Fleet page → the five personas are pre-selected → **Launch**. Panes fill.

> This is Station Kepler — a game we built for this, six rooms, first person. Five testers
> just started, each in its own sandbox. One line of reasoning per pane.

**Driver:** expand **Robert** as soon as a finding lands. Speaker reads it verbatim, then stops
talking for five seconds. Last run, that line was:

> *"How do I bend down?" — high, confusion. "The duct said its opening was too low, but didn't
> show how to get lower. The instructions I'd read hadn't explained bending down."*

> That's a 52-year-old who has never played a PC game, stuck on a control the game never
> taught. No crash. No error. A crash-hunter cannot see this. A beta tester would.

**Driver:** open **Personas** briefly — show the create form and the live "what the harness
will do to this person" preview. Ten seconds. Back to the fleet.

> You can make as many of these as you want. Tonight we ran five.

## 2:15 — Demo, part 2: the report (60s)

**Driver:** Runs → last night's completed run → **Open fleet report**.

> Here's the part nobody else can show you. We built the game with **fifteen deliberate
> flaws** and a decoy or two — so we hold the answer key, and we can grade ourselves.
>
> Five testers, full session, **thirty-three dollars.** Three of the fifteen planted flaws
> found. **Zero false alarms** — nobody reported the decoys. And **one thing we didn't plant.**

**Driver:** point at the emergent finding.

> Four of five testers stalled at the same four doors — locked, identical, silent. That
> wasn't in our ledger. The system attributed it to the *game*, not the agents, on ground
> truth: four different people, same room, four different doors, same complaint. And it's
> why recall is only twenty percent — that one door gated most of the fleet out of the rest
> of the game. That is exactly what a hundred early-access players would have found in week
> one. We found it before week one, in twenty minutes.

**Driver:** point at Priya's soft-lock.

> The one who got through used a fuse in the wrong room and soft-locked the game. She wrote a
> repro-quality bug report — in character — and the game's own telemetry confirmed it. We
> replayed her exact inputs at the same seed. It reproduced.

**Driver:** click analyst preset **1**. Let one paragraph render while the speaker finishes.

## 3:15 — Close (30s)

> Voice AI already tests with personas. Games couldn't — the models couldn't play. Astra
> changed that this month. As AI starts producing games faster than humans can play them,
> the testing has to be autonomous too, and it has to find what *people* find, not what
> crash logs find.
>
> That's synthetic playtesting. Different buyer, different budget line — the playtesting
> budget, not QA. Thank you.

Stop. Under time reads as confidence.

---

## 60-second version

> Beta testing is done by humans, and AI is about to make games faster than humans can play
> them. Voice AI solved this years ago with persona-driven testing — you write the impatient
> caller and let her hammer the agent. Games couldn't, because no model could play a game it
> had never seen. Astra can. So we built synthetic playtesting: describe testers as people,
> give each one a cloud sandbox and an Astra agent, and they play the way that person would —
> enforced, not prompted; a skimmer's screenshots are literally blurred. Last night five of
> them played a game we seeded with fifteen flaws, for thirty-three dollars: three found,
> zero false alarms, and one real problem we never planted that gated four of the five. Every
> finding replay-verified. That's the beta program, before week one.

## Hooks (pick one for the opening line)

- "Every game you've ever loved was tested by people. That's about to stop scaling."
- "Voice AI figured out persona testing years ago. Games just got the model that makes it possible."
- "We built a game with fifteen bugs on purpose, so we could grade our own testers."

## Q&A

**Bug or bad agent?** Three tiers, all from telemetry the agent never sees: enough testers
stalled at the same spot; or the game itself recorded a soft-lock; or enough reported it and
half of them stalled in that room. One tester alone → we label it "agent" and say so.

**Cost?** $0.06 a step for a short session, $0.20 a step deep in — Codex keeps the whole
conversation. $33 for five testers. 92% of tokens cached.

**Different from modl.ai / nunu.ai / Razer?** They find crashes. We find confusion — and we
can prove recall against an answer key, because we hold one.

**Do synthetic testers predict real players?** We claim *discovery*, not prediction: the
dead ends and silent doors a hundred people would have hit in week one, before week one.

**Why Astra specifically?** It sees a screen it has never seen and acts on it — zero-shot,
no SDK, no per-game training. And *playing badly in a specific, consistent way* while still
reasoning coherently is harder than playing well. Nobody else is demoing that.

**Why a game you wrote?** So we could grade ourselves. It's also the same reason a voice-AI
team writes its own test scenarios. Any browser game with a URL works the same way.
