/** Persona registry: packages/persona-mcp/personas/*.json, validated against PersonaConfig. */
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const READING = new Set(['skim', 'normal', 'thorough']);
const FAMILIARITY = new Set(['none', 'medium', 'high']);
const EXPLORATION = new Set(['low', 'medium', 'high']);
const EFFORT = new Set(['low', 'medium', 'high']);
const AUDIO = new Set(['on', 'off']);

/** Returns a list of problems; empty means valid. */
export function validatePersona(p) {
  const errs = [];
  if (!p || typeof p !== 'object') return ['body must be a PersonaConfig object'];
  if (typeof p.id !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(p.id)) errs.push('id: lowercase [a-z0-9_-], 1-64 chars');
  for (const k of ['name', 'bio', 'goal']) if (typeof p[k] !== 'string' || !p[k].trim()) errs.push(`${k}: non-empty string`);
  if (!Number.isFinite(p.age) || p.age < 1 || p.age > 120) errs.push('age: number 1-120');
  const e = p.enforcement;
  if (!e || typeof e !== 'object') errs.push('enforcement: object');
  else {
    if (!READING.has(e.reading)) errs.push('enforcement.reading: skim|normal|thorough');
    if (!FAMILIARITY.has(e.genre_familiarity)) errs.push('enforcement.genre_familiarity: none|medium|high');
    if (!Number.isInteger(e.patience) || e.patience < 1) errs.push('enforcement.patience: integer >= 1');
    if (!EXPLORATION.has(e.exploration)) errs.push('enforcement.exploration: low|medium|high');
    if (!AUDIO.has(e.audio)) errs.push('enforcement.audio: on|off');
    if (!Number.isInteger(e.step_budget) || e.step_budget < 1 || e.step_budget > 2000) errs.push('enforcement.step_budget: integer 1-2000');
    if (!EFFORT.has(e.reasoning_effort)) errs.push('enforcement.reasoning_effort: low|medium|high');
  }
  return errs;
}

/** Strip to exactly the PersonaConfig shape (no extra keys sneak into persona.json). */
export function normalizePersona(p) {
  const e = p.enforcement;
  return {
    id: p.id, name: p.name.trim(), age: Number(p.age), bio: p.bio.trim(), goal: p.goal.trim(),
    enforcement: {
      reading: e.reading, genre_familiarity: e.genre_familiarity, patience: e.patience,
      exploration: e.exploration, audio: e.audio, step_budget: e.step_budget, reasoning_effort: e.reasoning_effort,
    },
  };
}

export class PersonaRegistry {
  constructor(dir, log = console.log) { this.dir = dir; this.log = log; this.map = new Map(); this.reload(); }

  reload() {
    this.map.clear();
    mkdirSync(this.dir, { recursive: true });
    for (const f of readdirSync(this.dir).filter((f) => f.endsWith('.json')).sort()) {
      try {
        const p = JSON.parse(readFileSync(join(this.dir, f), 'utf8'));
        const errs = validatePersona(p);
        if (errs.length) { this.log(`personas: skipping ${f}: ${errs.join('; ')}`); continue; }
        if (p.id !== f.replace(/\.json$/, '')) this.log(`personas: note ${f} has id "${p.id}"`);
        this.map.set(p.id, normalizePersona(p));
      } catch (err) { this.log(`personas: skipping ${f}: ${err.message}`); }
    }
    this.log(`personas: ${this.map.size} loaded from ${this.dir} (${[...this.map.keys()].join(', ')})`);
  }

  list() { return [...this.map.values()]; }
  get(id) { return this.map.get(id); }
  pathFor(id) { return join(this.dir, `${id}.json`); }

  /** Upsert — writes <id>.json into the registry dir. */
  save(p) {
    const clean = normalizePersona(p);
    writeFileSync(this.pathFor(clean.id), JSON.stringify(clean, null, 2) + '\n');
    this.map.set(clean.id, clean);
    return clean;
  }
}
