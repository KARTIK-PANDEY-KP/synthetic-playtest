#!/usr/bin/env bash
# Spike 01 — proves a Codex CLI agent can see a PNG delivered as a file path via MCP.
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

ANSWER_KEY="${SPIKE_ANSWER_KEY:-$DIR/../../../spike-answer-key.json}"
export SPIKE_ANSWER_KEY="$ANSWER_KEY"

echo "==> regenerating fixture with a fresh random secret"
node make-fixture.mjs

echo "==> confirming the secret exists ONLY in pixels, not as text in the workspace"
SECRET=$(node -e "console.log(require('$ANSWER_KEY').secret)")
if grep -rl "$SECRET" . --exclude-dir=node_modules >/dev/null 2>&1; then
  echo "FAIL: secret leaked into the workspace as text — spike would be invalid." >&2
  exit 1
fi
echo "    ok: '$SECRET' appears nowhere in the workspace as text"

mkdir -p codex-home
[ -f codex-home/auth.json ] || cp ~/.codex/auth.json codex-home/auth.json
cat > codex-home/config.toml <<TOML
model = "gpt-6-astra"
model_reasoning_effort = "medium"

[mcp_servers.game]
command = "node"
args = ["$DIR/mcp-server.mjs"]

[mcp_servers.game.env]
SPIKE_FIXTURE = "$DIR/fixture.png"
TOML

echo "==> running codex exec"
CODEX_HOME="$DIR/codex-home" codex exec --json \
  --skip-git-repo-check --approve-for-me -C "$DIR" -m gpt-6-astra \
  "Call the take_screenshot tool from the 'game' MCP server. It returns a FILE PATH.
Open and look at that PNG. Then report:
SECRET: the large word on screen
SHAPES: the three shapes left to right with colours
If you cannot actually see the image, say 'CANNOT SEE IMAGE'." \
  | grep -E '"type":"item.completed"|turn.completed'

echo
echo "==> answer key (held outside the agent's workspace):"
cat "$ANSWER_KEY"
