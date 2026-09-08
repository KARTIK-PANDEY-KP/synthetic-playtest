/**
 * MODAL backend — one Modal Sandbox per persona, driven by infra/modal/sandbox.py.
 *
 * The Python control script creates the sandbox from infra/modal/image.py, serves
 * the game in-sandbox on 5273, runs the runner with --viewer-port 8080, relays the
 * runner's SessionEvent lines to its own stdout, and prints control lines:
 *   {"_ctl":"sandbox","sandboxId":..,"tunnelUrl":..,"bootMs":..}
 *   {"_ctl":"log","msg":..}   {"_ctl":"downloaded",..}   {"_ctl":"exit","code":..}
 * It accepts {"cmd":"pause"|"resume"|"stop"} on stdin. SIGTERM tears the sandbox down.
 */
import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { ChildRunner } from './child.mjs';

/** Find a Python that has the `modal` package: MODAL_PYTHON, else the shebang of `modal`, else python3. */
export function resolveModalPython(cfg, log) {
  if (cfg.modalPython) return cfg.modalPython;
  try {
    const bin = execFileSync('which', ['modal'], { encoding: 'utf8' }).trim();
    const first = readFileSync(bin, 'utf8').split('\n')[0];
    if (first.startsWith('#!')) {
      const py = first.slice(2).trim().split(/\s+/).find((p) => p.includes('python')) ?? first.slice(2).trim();
      if (existsSync(py)) return py;
    }
  } catch { /* fall through */ }
  log('modal: could not derive the modal CLI interpreter; using python3 (set MODAL_PYTHON to override)');
  return 'python3';
}

export function startModal({ cfg, root, runId, key, personaFile, outDir, seed, maxSteps, log }) {
  const script = join(root, 'infra', 'modal', 'sandbox.py');
  const python = resolveModalPython(cfg, log);
  // global options go BEFORE the subcommand (argparse)
  const args = [script, '--app-name', cfg.modalAppName, '--secret-name', cfg.modalSecretName, 'run',
    '--run-id', runId, '--key', key, '--persona', personaFile, '--out', outDir, '--seed', String(seed),
    '--runner', cfg.modalRunner];
  if (maxSteps) args.push('--max-steps', String(maxSteps));

  const label = `${runId}/${key}`;
  log(`modal: ${python} ${args.map((a) => (/\s/.test(a) ? JSON.stringify(a) : a)).join(' ')}`);
  const child = new ChildRunner({ cmd: python, args, cwd: root, env: { PYTHONUNBUFFERED: '1', PYTHONDONTWRITEBYTECODE: '1' }, label, log });

  let tunnelUrl = null;
  let sandboxId = null;
  child.on('ctl', (c) => {
    if (c._ctl === 'sandbox') { tunnelUrl = c.tunnelUrl; sandboxId = c.sandboxId; log(`modal: ${label} sandbox ${sandboxId} up in ${c.bootMs}ms → ${tunnelUrl}`); }
    else if (c._ctl === 'log') log(`modal: ${label}: ${c.msg}`);
  });

  return {
    backend: 'modal',
    child,
    pid: child.pid,
    status: 'starting',
    get sandboxId() { return sandboxId; },
    viewerUrl: () => tunnelUrl,
    on: (...a) => child.on(...a),
    stop: () => { child.send({ cmd: 'stop' }); child.stop(60_000); },
    pause: () => child.send({ cmd: 'pause' }),
    resume: () => child.send({ cmd: 'resume' }),
  };
}
