/** Paths, ports and env. Every path goes through fileURLToPath — the repo path has a space. */
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';

export const ROOT = fileURLToPath(new URL('../../../', import.meta.url));

// Load .env from the repo root if present (never committed). Does not override real env.
for (const file of ['.env', '.env.local']) {
  const p = join(ROOT, file);
  if (!existsSync(p)) continue;
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i);
    if (!m || m[1] in process.env) continue;
    process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}

const env = (k, d) => (process.env[k] === undefined || process.env[k] === '' ? d : process.env[k]);
const num = (k, d) => Number(env(k, d));

export const config = {
  port: num('PORT', 4000),
  publicBaseUrl: env('PUBLIC_BASE_URL', `http://127.0.0.1:${num('PORT', 4000)}`),

  runsDir: resolve(ROOT, env('RUNS_DIR', 'runs')),
  personasDir: resolve(ROOT, env('PERSONAS_DIR', 'packages/persona-mcp/personas')),
  gameDist: resolve(ROOT, env('GAME_DIST', 'apps/game/dist')),
  gamePort: num('GAME_PORT', 5273),
  /** URL the LOCAL backend hands to runners. Defaults to the game we serve ourselves. */
  gameUrl: env('GAME_URL', `http://127.0.0.1:${num('GAME_PORT', 5273)}/`),

  /** Command prefix for the runner CLI (split on spaces). The real runner is the default. */
  runnerCmd: env('RUNNER_CMD', 'node packages/persona-mcp/runner.mjs'),
  /** Set to 1 if the runner does NOT accept --viewer-port (then /live falls back to frames). */
  runnerNoViewer: env('RUNNER_NO_VIEWER', '0') === '1',
  /** Set to 1 if the runner honours SIGUSR1 (pause) / SIGUSR2 (resume). fake-runner does. */
  runnerPauseSignals: env('RUNNER_PAUSE_SIGNALS', '0') === '1',
  /** Optional global --max-steps override (staggered like step budgets). Handy for demos. */
  runnerMaxSteps: env('RUNNER_MAX_STEPS') ? num('RUNNER_MAX_STEPS') : null,
  viewerPortBase: num('VIEWER_PORT_BASE', 9100),

  analysisCli: resolve(ROOT, env('ANALYSIS_CLI', 'packages/analysis/cli.mjs')),
  ledgerPath: resolve(ROOT, env('LEDGER_PATH', 'apps/game/src/flaws/ledger.json')),

  // governor — tier-1 limits per docs/PLAN-PLATFORM.md
  tpmLimit: num('TPM_LIMIT', 500_000),
  rpmLimit: num('RPM_LIMIT', 500),
  /** Count cached input tokens toward TPM? Default no: the plan's arithmetic counts uncached+output. */
  governorCountCached: env('GOVERNOR_COUNT_CACHED', '0') === '1',
  headroomMin: num('GOVERNOR_HEADROOM', 0.15),
  startStaggerMs: num('START_STAGGER_MS', 1500),
  maxStarting: num('MAX_STARTING', 3),
  budgetStagger: num('BUDGET_STAGGER', 0.15),

  // modal
  modalPython: env('MODAL_PYTHON', ''),
  modalRunner: env('MODAL_RUNNER', '/app/packages/persona-mcp/runner.mjs'),
  modalAppName: env('MODAL_APP_NAME', 'synthetic-playtest'),
  modalSecretName: env('MODAL_SECRET_NAME', 'codex-api-key'),
};
