# Spike 01 — Can a Codex CLI agent see the game? ✅ PASSED

**Date:** 2026-09-08 · **Status:** PASSED, confound ruled out · **Gate for:** the entire perception architecture

## The question

Codex CLI **drops image content blocks returned from MCP tool results**
([openai/codex#4819](https://github.com/openai/codex/issues/4819),
[#10334](https://github.com/openai/codex/issues/10334)). So an MCP `screenshot` tool that
returns an image will not reach the model.

The proposed workaround: the tool writes a PNG to disk and returns only the **path**;
the agent then opens that file itself. Does that actually work end to end?

## Method

1. Playwright renders a fixture PNG containing a **randomly generated secret**
   (`QUILVERN-2277`) and three coloured shapes in a specific order.
2. A stdio MCP server exposes one tool, `take_screenshot`, which returns **only the file
   path** plus dimensions — explicitly *not* the contents.
3. `codex exec --json -m gpt-6-astra` is asked to call the tool, look at the file, and
   report the secret and the shapes.
4. The answer key is written **outside the agent's workspace**, and we verify with `grep`
   that the secret exists nowhere in the workspace as text — only in the PNG's pixels.

Step 4 matters. The first run left `fixture.answer.json` inside the workspace, so the
agent could have read the answer rather than viewed the image. That result was discarded
and the spike re-run clean.

## Result

```
SECRET: QUILVERN-2277
SHAPES: Orange square, green circle, violet triangle.
```

Answer key: `{"secret":"QUILVERN-2277","shapes":["orange square","limegreen circle","violet triangle"]}`

Exact match. The agent genuinely saw the image.

## What this changes

### 1. `--approve-for-me`, NOT `--dangerously-bypass-approvals-and-sandbox`

MCP tool calls fail under `-s read-only` with:

```
MCP tool call requires approval, but approval policy is never
```

`-c mcp_servers.<name>.trusted=true` is silently ignored (accepted by `--strict-config`,
no effect). The flag that works is **`--approve-for-me`**, which routes approval requests
through automatic review using the workspace-write sandbox.

This is strictly safer than planned and **removes the need for the dangerous bypass flag
entirely**, in Modal and locally.

### 2. Measured cost is ~2× the estimate

| Metric | Value |
|---|---|
| Input tokens | 64,274 (**59,264 cached**) |
| Output tokens | 158 |
| **Cost** | **~$0.117 / step** |

Codex CLI carries a **~46K-token system prefix**. At the $1/M cached rate that's ~$0.046
per step of pure harness overhead — ~$4.60 per 100-step session before the game is even
looked at. Revised fleet estimate: **~$45 per 4-persona run**, not $25–35.

Prompt caching is doing real work (92% of input cached) and must not be broken: **keep the
persona prefix byte-stable across steps.**

## Working invocation

```bash
CODEX_HOME="$DIR/codex-home" codex exec --json \
  --skip-git-repo-check \
  --approve-for-me \
  -C "$DIR" \
  -m gpt-6-astra \
  "<persona brief>"
```

with `$CODEX_HOME/config.toml`:

```toml
model = "gpt-6-astra"
model_reasoning_effort = "medium"

[mcp_servers.game]
command = "node"
args = ["/abs/path/to/persona-mcp/server.mjs"]

[mcp_servers.game.env]
PERSONA_CONFIG = "/abs/path/to/persona.json"
```

### 3. `--approve-for-me` spawns a paid reviewer session — pre-approve the MCP server instead

Found by the runner workstream in the first real sessions: with `--approve-for-me`, Codex
routes each MCP tool approval through a **second model session** whose tokens do not
appear in `turn.completed.usage`. On a 25-step run it cost **~$0.66 on top of $0.97** —
40% hidden overhead. Setting this in the run's `config.toml` removes it entirely:

```toml
[mcp_servers.game]
default_tools_approval_mode = "approve"   # valid: auto | prompt | writes | approve
```

`--approve-for-me` stays on the command line (it is what makes MCP calls legal at all),
but with the server pre-approved no reviewer is ever consulted. Measured across three
real sessions afterwards: **$0.80–0.97 per 13–25-step run, 92–94% of input cached.**

## Reproduce

```bash
cd spikes/codex-vision && pnpm install && pnpm exec playwright install chromium
node make-fixture.mjs   # regenerates fixture.png with a fresh secret
./run.sh
```
