# Hackathon submission — GPT-6 Astra Hackathon SF (Cerebral Valley)

Paste-ready answers. Repo: https://github.com/KARTIK-PANDEY-KP/synthetic-playtest

## Team name

Synthetic Playtest

## Project description

Beta testing is done by humans — hundreds of early-access players finding out whether a game
is confusing, boring, or unfair, not just whether it crashes. AI is about to produce games
faster than humans can play them, and every existing AI game-testing tool only finds crashes.

Synthetic Playtest replaces the beta program with a fleet of GPT-6 Astra agents that play a
game *as specific people*. You describe testers as personas — Maya, a streamer who skims
everything; Robert, 52, first PC game ever; Dana, who plays with the sound off — and the
harness **enforces** who they are rather than asking a prompt nicely: Maya's screenshots have
long text blurred out before the model sees them; Dana has no "listen" tool at all. Each
persona gets its own cloud sandbox (Modal) with a browser and a Codex agent, plays the game
through screenshots and real input only, and files findings in character. Reports are
deduplicated across testers, attributed to the game vs. the agent using telemetry the agents
never see, and every finding with a ground-truth signal is **replay-verified** by re-running
the exact inputs at the same seed.

To prove it works we built the test subject too: Station Kepler, a six-room first-person 3D
game seeded with **15 deliberate flaws and 2 decoys**, so we hold an answer key and can score
recall and precision. First real fleet run — five personas, $33: three planted flaws found,
zero false alarms, and one real problem nobody planted (four silent, identical locked doors
that stalled four of five testers). Verification reproduced 3/3 findings on replay.

Persona-driven testing already runs the voice-AI industry. Games never got it because no
model could play a game it had never seen. Astra can. Nothing in the pipeline is
game-specific — any walkable 3D asset gets the same fleet of people.

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
