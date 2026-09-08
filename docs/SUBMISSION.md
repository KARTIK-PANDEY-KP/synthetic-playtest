# Hackathon submission — GPT-6 Astra Hackathon SF (Cerebral Valley)

Paste-ready answers. Repo: https://github.com/KARTIK-PANDEY-KP/synthetic-playtest

## Team name

Synthetic Playtest

## Project description

Every game you've ever loved was tested by people. Not just QA looking for crashes — beta
testers and early-access players, hundreds of them, playing the way real people play:
skimming the tutorial, getting lost, getting bored, quitting at a door that won't open.
That's the only way a studio learns whether a game is *confusing*, not just whether it's
*broken*, and it costs weeks and real money.

That worked when a studio shipped a game every three years. It won't work now. AI is about
to make games — and 3D worlds, levels, and assets — faster than humans can play them.
More titles, more builds, more iterations a day than there are people to test them. The
bottleneck in game production is about to be testing.

We've watched this exact problem get solved once already, in voice AI. Nobody QAs a voice
agent by hand anymore: you write personas — the impatient caller, the confused senior, the
one who mumbles — and let them hammer the agent thousands of times. Persona-driven testing
is how that whole industry ships. Games never got it, for one reason: no model could play a
game it had never seen. GPT-6 Astra can. So we built it.

**Synthetic Playtest** is the beta program, run by agents. You describe testers as *people* —
Maya, a streamer who skims everything; Robert, 52, first PC game ever; Dana, who plays with
the sound off. Each one gets its own cloud sandbox with a browser and an Astra agent and
plays the game the way that person would — not because a prompt asked nicely, but because
the harness enforces it: Maya's screenshots have long text blurred out before the model ever
sees them; Dana has no "listen" tool at all. They see only pixels and press only keys. As
they play they file what a beta tester would file — confusion, boredom, unfairness, bugs —
in their own voice. Reports are deduplicated across the fleet, attributed to the game or to
the agent using telemetry the agents never see, and every finding with a ground-truth signal
is replay-verified by re-running the exact inputs at the same seed. You can make as many
personas as you want and watch every one of them live.

To prove it works we built the test subject too: Station Kepler, a six-room first-person 3D
game seeded with fifteen deliberate flaws and two decoys, so we hold an answer key and can
score ourselves. First real run — five personas, $33: three planted flaws found, zero false
alarms, and one real problem nobody planted — four silent, identical locked doors that
stalled four of five testers, exactly what a hundred early-access players would have found
in week one. Found before week one, in twenty minutes.

And this isn't only for games. The agents don't know they're in a game; they know they're
a person in a 3D space, looking and trying. Make any 3D asset walkable — a building, a
vehicle interior, a product model, a level block-out — and the same fleet walks it as a
first-timer, a power user, someone who can't hear, someone who won't read, and reports what
each of them noticed and would change. We didn't build that tonight, but nothing in the
pipeline is game-specific. The pattern is human personas, enforced, at scale, doing a job
that currently needs a room full of people to try something and say how it felt. Testing
is the first such job. It won't be the last.

## Public GitHub repository

https://github.com/KARTIK-PANDEY-KP/synthetic-playtest

## Use of OpenAI products

Everything that reasons in this project is **GPT-6 Astra**, driven through the **Codex CLI**:

- **The players.** Each persona is a `codex exec --json` session with `gpt-6-astra`. The game
  is exposed to it only through a custom MCP server (`screenshot`, `move`, `look`, `interact`,
  `note_finding`, `abandon`, …). Perception is Astra's vision on real screenshots of a 3D game
  it has never seen — zero-shot, no SDK, no per-game training. `--output-schema` forces the
  final playtest report into a typed JSON schema.
- **Persona enforcement rides on Codex's tool model**: the tool list itself changes per persona
  (no `listen` for a deaf persona), and reading level is enforced by redacting pixels before
  the file reaches `view_image`. `reasoning_effort` is the cost dial per persona (low for
  skimmers, medium for careful readers). Prompt caching carried 90–94% of input tokens.
- **The analyst.** Cross-persona clustering (`--llm`) and the report Q&A are one Astra call
  each via `codex exec` with all reports in context.
- **The game itself** — six rooms, deterministic replay, the flaw ledger — was built by a
  Codex agent from a written spec.
- Infra (not OpenAI): Modal sandboxes, Playwright, Three.js, Next.js.

## Feedback on GPT-6 Astra

**What was remarkable.** Astra played a first-person 3D game it had never seen, from
screenshots alone, and stayed *in character under structural constraints* — a skimmer with
blurred text, a first-timer who had never heard of WASD — for a hundred-plus steps without
collapsing into a generic competent assistant. Playing badly in a specific, consistent way
while still reasoning coherently is harder than playing well, and it did it. Findings were
genuinely useful: it discovered a real usability problem we had not planted (silent locked
doors) that four of five personas independently hit. Cache hit rates of 90–94% made
per-step cost workable.

**Where we lost hours — all in the Codex CLI harness, none in the model:**

1. **MCP image content is dropped.** Codex ignores image blocks returned from MCP tools
   (openai/codex#4819, #10334). Our screenshot tool has to write a PNG and return the path,
   and the agent calls `view_image` itself. Two calls per look.
2. **`--approve-for-me` spawns a hidden reviewer session** whose tokens never appear in
   `turn.completed.usage` — ~40% extra cost per run before we found
   `default_tools_approval_mode = "approve"` (valid values only discoverable from a config
   error). Please document this.
3. **`mcp_servers.<name>.trusted = true` is silently accepted and does nothing.**
4. **Codex's Linux sandbox (bubblewrap) cannot start inside a container.** In Modal every
   `view_image` failed with `bwrap: loopback: Failed RTM_NEWADDR` and agents played blind.
   The bypass flag works, but the failure mode should be detected and explained.
5. **Usage is reported once, at turn end.** No live cost meter is possible for a
   long-running agent without parsing `sessions/*.jsonl`.
6. **Cost is superlinear in steps** because the full conversation is retained: $0.06/step at
   13 steps, $0.20/step at 115. Server-side compaction for long agentic sessions would change
   the economics of exactly this kind of workload.
7. `codex exec` appends stdin to an argv prompt, which breaks a byte-stable cached prefix —
   pipe the whole prompt via stdin. Strict output schemas reject optional fields; we derive a
   nullable twin at runtime.

Net: the model is ready for this workload today; the CLI needs a "long-running agent with
custom perception" path that doesn't require rediscovering these seven things.
