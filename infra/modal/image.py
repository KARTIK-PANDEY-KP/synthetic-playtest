"""
Modal sandbox image for one persona.

Debian (node:22-bookworm-slim) + pnpm + Codex CLI + Playwright Chromium with OS deps,
with the runtime npm deps baked in at /app/node_modules. The repo's built artifacts
are MOUNTED at sandbox start (copy=False), so editing the game, persona-mcp or the
runner never requires an image rebuild — only dependency changes do.

    /app/apps/game/dist            static game build  (served in-sandbox on 5273)
    /app/packages/persona-mcp      runner.mjs / server.mjs / driver.js / personas
    /app/packages/protocol         contract.ts, report.schema.json
    /app/apps/orchestrator/dev     fake-runner.mjs (stand-in until the real runner lands)
    /app/infra/modal               serve-game.mjs, probe-screenshot.mjs
"""
from pathlib import Path

import modal

REPO = Path(__file__).resolve().parents[2]
APP_DIR = "/app"

# Ignore patterns for mounted dirs — never ship node_modules or run output.
_IGNORE = ["**/node_modules", "**/node_modules/**", "**/.DS_Store", "**/runs", "**/runs/**"]


def build_image(force_build: bool = False) -> modal.Image:
    return (
        modal.Image.from_registry("node:22-bookworm-slim", force_build=force_build)
        .apt_install("curl", "ca-certificates", "procps", "tar")
        .run_commands(
            "npm install -g pnpm @openai/codex --no-audit --no-fund",
            "codex --version",
        )
        .add_local_file(REPO / "infra/modal/sandbox-package.json", f"{APP_DIR}/package.json", copy=True)
        .run_commands(
            f"cd {APP_DIR} && npm install --omit=dev --no-audit --no-fund",
            f"cd {APP_DIR} && npx playwright install --with-deps chromium",
            "rm -rf /var/lib/apt/lists/* /root/.npm/_cacache",
        )
        .env({"NODE_ENV": "production", "PLAYWRIGHT_BROWSERS_PATH": "/root/.cache/ms-playwright"})
        .workdir(APP_DIR)
        # ── mounted at sandbox start; no rebuild needed when these change ──
        .add_local_dir(REPO / "apps/game/dist", f"{APP_DIR}/apps/game/dist", ignore=_IGNORE)
        .add_local_dir(REPO / "packages/persona-mcp", f"{APP_DIR}/packages/persona-mcp", ignore=_IGNORE)
        .add_local_dir(REPO / "packages/protocol", f"{APP_DIR}/packages/protocol", ignore=_IGNORE)
        .add_local_dir(REPO / "apps/orchestrator/dev", f"{APP_DIR}/apps/orchestrator/dev", ignore=_IGNORE)
        .add_local_file(REPO / "infra/modal/serve-game.mjs", f"{APP_DIR}/infra/modal/serve-game.mjs")
        .add_local_file(REPO / "infra/modal/probe-screenshot.mjs", f"{APP_DIR}/infra/modal/probe-screenshot.mjs")
    )
