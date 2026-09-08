/**
 * Shared child-process plumbing for both backends: spawn a command, split its
 * stdout into lines, parse SessionEvents (any JSON with a `kind`) and control
 * lines (JSON with `_ctl`), surface stderr, and report exit.
 */
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { createInterface } from 'node:readline';

export class ChildRunner extends EventEmitter {
  constructor({ cmd, args, cwd, env, label, log = console.log }) {
    super();
    this.label = label; this.log = log;
    this.exited = false; this.exitCode = null; this.stopRequested = false;
    this.child = spawn(cmd, args, { cwd, env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
    this.pid = this.child.pid;

    createInterface({ input: this.child.stdout }).on('line', (line) => {
      const s = line.trim();
      if (!s) return;
      if (s[0] !== '{') { this.emit('log', s); return; }
      let obj;
      try { obj = JSON.parse(s); } catch { this.emit('log', s); return; }
      if (obj._ctl) this.emit('ctl', obj);
      else if (obj.kind) this.emit('event', obj);
      else this.emit('log', s);
    });
    createInterface({ input: this.child.stderr }).on('line', (line) => { if (line.trim()) this.emit('stderr', line); });

    this.child.on('error', (err) => { this.log(`${label}: spawn error: ${err.message}`); this.#finish(-1, err.message); });
    this.child.on('exit', (code, signal) => this.#finish(code ?? (signal ? 128 : 1), signal));
  }

  #finish(code, signal) {
    if (this.exited) return;
    this.exited = true; this.exitCode = code;
    this.emit('exit', { code, signal, stopRequested: this.stopRequested });
  }

  /** Write a JSON command line to the child's stdin (used by the modal control script). */
  send(obj) { try { this.child.stdin.write(JSON.stringify(obj) + '\n'); } catch { /* closed */ } }

  signal(sig) { try { if (!this.exited) this.child.kill(sig); } catch { /* gone */ } }

  /** Graceful stop: SIGTERM, then SIGKILL after `graceMs`. */
  stop(graceMs = 15_000) {
    if (this.exited) return;
    this.stopRequested = true;
    this.signal('SIGTERM');
    setTimeout(() => this.signal('SIGKILL'), graceMs).unref();
  }
}

/** Split a command string on whitespace (respecting simple quotes) into [cmd, ...args]. */
export function splitCmd(s) {
  const out = []; let cur = '', q = null;
  for (const ch of s) {
    if (q) { if (ch === q) q = null; else cur += ch; }
    else if (ch === '"' || ch === "'") q = ch;
    else if (/\s/.test(ch)) { if (cur) { out.push(cur); cur = ''; } }
    else cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}
