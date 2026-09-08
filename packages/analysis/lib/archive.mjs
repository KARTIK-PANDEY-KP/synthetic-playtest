/**
 * Read a run archive (contract.ts §"Run archive layout") into memory.
 *
 *   runs/<runId>/run.json
 *   runs/<runId>/<persona>/{persona.json, session.jsonl, report.json, cost.json, frames/}
 *   runs/<runId>/analysis/{findings.json, score.json, report.md, report.html}
 */
import { existsSync, readFileSync, readdirSync, statSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

export const INPUT_TOOLS = new Set(['move', 'look', 'crouch', 'interact', 'use_item', 'open_inventory', 'type_text']);
/** Ground-truth events that mean the tester actually got somewhere. flaw_triggered is
 *  deliberately NOT progress here: hitting a flaw while stuck is still stuck. */
export const PROGRESS_EVENTS = new Set(['room_entered', 'item_picked', 'item_used', 'puzzle_solved']);
export const SIGNAL_EVENTS = new Set(['flaw_triggered', 'softlock_entered', 'puzzle_failed', 'died']);

const readJson = (p, fallback = undefined) => {
  if (!existsSync(p)) { if (fallback !== undefined) return fallback; throw new Error(`missing ${p}`); }
  return JSON.parse(readFileSync(p, 'utf8'));
};

const readJsonl = (p) => {
  if (!existsSync(p)) return [];
  const out = [];
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    const s = line.trim(); if (!s) continue;
    try { out.push(JSON.parse(s)); } catch { /* skip torn line */ }
  }
  return out;
};

/** Load the whole run. Personas come from run.json when present, else from subdirectories. */
export function loadRun(runDir) {
  const dir = resolve(runDir);
  if (!existsSync(dir)) throw new Error(`run dir not found: ${dir}`);
  const meta = readJson(join(dir, 'run.json'), null);
  let ids = meta?.personas ?? [];
  if (!ids.length) {
    ids = readdirSync(dir).filter((d) => d !== 'analysis' && statSync(join(dir, d)).isDirectory() && existsSync(join(dir, d, 'session.jsonl')));
  }
  const personas = ids.map((id) => loadPersona(dir, id)).filter(Boolean);
  return {
    dir,
    meta: meta ?? { runId: dir.split('/').pop(), seed: 1, personas: ids, gameUrl: '', backend: 'local', status: 'done', startedAt: '' },
    personas,
    analysisDir: join(dir, 'analysis'),
  };
}

export function loadPersona(runDir, id) {
  const pdir = join(runDir, id);
  if (!existsSync(pdir)) return null;
  const config = readJson(join(pdir, 'persona.json'), { id, name: id, enforcement: {} });
  const session = readJsonl(join(pdir, 'session.jsonl'));
  const report = readJson(join(pdir, 'report.json'), null);
  const cost = readJson(join(pdir, 'cost.json'), null);
  const actions = session.filter((e) => e.kind === 'action');
  const inputActions = actions.filter((a) => INPUT_TOOLS.has(a.tool));
  // The inner event.t is game-ms since boot; the OUTER e.t is when the harness saw it,
  // on the same epoch clock as actions. Step mapping must use the outer one, or every
  // telemetry event sorts before every action and lands at step 0.
  const telemetry = session.filter((e) => e.kind === 'telemetry').map((e) => ({ ...e.event, t: e.t, gameT: e.event.t }));
  telemetry.sort((a, b) => a.t - b.t);
  const status = [...session].reverse().find((e) => e.kind === 'status')?.status ?? (report ? 'done' : 'failed');

  // Findings: report.json is canonical; fall back to note_finding session events for
  // personas whose report never landed (a failed session still has live findings).
  let findings = report?.findings ?? [];
  if (!findings.length) {
    const seen = new Set();
    for (const e of session) if (e.kind === 'finding' && e.finding && !seen.has(e.finding.id)) { seen.add(e.finding.id); findings.push(e.finding); }
  }

  return {
    id, dir: pdir, config, session, report, cost, status, findings,
    actions, inputActions, telemetry,
    name: config.name ?? id,
    enforcement: config.enforcement ?? {},
    /** Step index at which a telemetry event happened: the input action whose t is the last ≤ event.t. */
    stepAt(t) {
      let n = 0;
      for (const a of inputActions) { if (a.t <= t) n++; else break; }
      return Math.max(0, n - 1);
    },
    /** Time of the input action at `step` (or the nearest earlier one). */
    timeAtStep(step) {
      const a = inputActions.find((x) => x.step === step) ?? inputActions.filter((x) => x.step <= step).pop();
      return a?.t ?? 0;
    },
    /** Ground-truth room at time t (last room_entered before t). */
    roomAt(t) {
      let room = null;
      for (const e of telemetry) { if (e.t > t) break; if (e.type === 'room_entered') room = e.room; }
      return room;
    },
    /** Last known position at time t. */
    positionAt(t) {
      let pos = null;
      for (const e of telemetry) { if (e.t > t) break; if (e.type === 'position') pos = e; }
      return pos;
    },
    roomsReached() {
      return [...new Set(telemetry.filter((e) => e.type === 'room_entered').map((e) => e.room))];
    },
    lastRoom() {
      const rooms = telemetry.filter((e) => e.type === 'room_entered');
      return rooms.length ? rooms[rooms.length - 1].room : null;
    },
  };
}

export function ensureAnalysisDir(run) { mkdirSync(run.analysisDir, { recursive: true }); return run.analysisDir; }
export function writeAnalysis(run, name, data) {
  ensureAnalysisDir(run);
  const p = join(run.analysisDir, name);
  writeFileSync(p, typeof data === 'string' ? data : JSON.stringify(data, null, 2) + '\n');
  return p;
}
export function readAnalysis(run, name, fallback = null) {
  const p = join(run.analysisDir, name);
  if (!existsSync(p)) return fallback;
  return name.endsWith('.json') ? JSON.parse(readFileSync(p, 'utf8')) : readFileSync(p, 'utf8');
}
export { readJson, readJsonl };
