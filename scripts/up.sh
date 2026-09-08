#!/usr/bin/env bash
# Spin up everything locally: game (served by the orchestrator), orchestrator API, dashboard.
#   pnpm stack               → local backend (agents run as processes on this machine)
#   BACKEND=modal pnpm stack  → default the launcher to Modal sandboxes (needs CODEX_API_KEY + modal auth)
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f .env ] && set -a && . ./.env && set +a
[ -d apps/game/dist ] || pnpm game:build
[ -d apps/dashboard/.next ] || (cd apps/dashboard && pnpm exec next build)
cleanup() { kill "${ORCH:-}" "${DASH:-}" 2>/dev/null || true; }
trap cleanup EXIT INT TERM
PORT="${PORT:-4000}" GAME_PORT="${GAME_PORT:-5273}" node apps/orchestrator/src/index.mjs & ORCH=$!
( cd apps/dashboard && NEXT_PUBLIC_ORCHESTRATOR_URL="http://localhost:${PORT:-4000}" exec pnpm exec next start -p "${DASH_PORT:-3000}" ) & DASH=$!
sleep 3
echo
echo "  dashboard    → http://localhost:${DASH_PORT:-3000}"
echo "  orchestrator → http://localhost:${PORT:-4000}/api/health"
echo "  game         → http://localhost:${GAME_PORT:-5273}"
echo "  ctrl-c stops all three."
wait
