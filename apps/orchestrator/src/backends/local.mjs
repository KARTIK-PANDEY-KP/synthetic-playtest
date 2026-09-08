/**
 * LOCAL backend — spawns the runner CLI on this machine, one process per persona.
 *
 *   <RUNNER_CMD> --persona <file> --game-url <url> --seed <n> --out runs/<runId>/<key>
 *                --viewer-port <unique> [--max-steps N]
 *
 * Emits: 'event' (SessionEvent), 'exit' ({code, stopRequested}), 'log'/'stderr'.
 * handle.viewerUrl() resolves to http://127.0.0.1:<viewerPort> (or null with RUNNER_NO_VIEWER).
 */
import { ChildRunner, splitCmd } from './child.mjs';

let nextViewerPort = null;

export function startLocal({ cfg, root, runId, key, personaFile, outDir, seed, maxSteps, log }) {
  if (nextViewerPort === null) nextViewerPort = cfg.viewerPortBase;
  const viewerPort = cfg.runnerNoViewer ? null : nextViewerPort++;

  const [cmd, ...baseArgs] = splitCmd(cfg.runnerCmd);
  const args = [...baseArgs,
    '--persona', personaFile, '--game-url', cfg.gameUrl, '--seed', String(seed), '--out', outDir];
  if (viewerPort) args.push('--viewer-port', String(viewerPort));
  if (maxSteps) args.push('--max-steps', String(maxSteps));

  const label = `${runId}/${key}`;
  log(`local: spawn ${cmd} ${args.map((a) => (/\s/.test(a) ? JSON.stringify(a) : a)).join(' ')}`);
  const child = new ChildRunner({ cmd, args, cwd: root, env: {}, label, log });

  return {
    backend: 'local',
    child,
    pid: child.pid,
    status: 'starting',
    viewerUrl: () => (viewerPort ? `http://127.0.0.1:${viewerPort}` : null),
    on: (...a) => child.on(...a),
    stop: () => child.stop(),
    pause: cfg.runnerPauseSignals ? () => child.signal('SIGUSR1') : null,
    resume: cfg.runnerPauseSignals ? () => child.signal('SIGUSR2') : null,
  };
}
