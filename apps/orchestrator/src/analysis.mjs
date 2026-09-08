/**
 * Analysis hook — shells out to packages/analysis/cli.mjs per the ANALYSIS CLI
 * contract once a run finishes. The package is built concurrently, so every
 * call is guarded: if the CLI is missing or a step fails, we fall back to a
 * naive concatenation of the persona reports so the dashboard still has data.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

function sh(cmd, args, { cwd, timeoutMs, log, label }) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    const timer = setTimeout(() => { child.kill('SIGKILL'); err += `\n${label}: timed out after ${timeoutMs}ms`; }, timeoutMs);
    child.on('error', (e) => { clearTimeout(timer); resolve({ code: -1, out, err: err + e.message }); });
    child.on('exit', (code) => { clearTimeout(timer); if (code !== 0) log(`analysis: ${label} exited ${code}: ${err.trim().split('\n').slice(-3).join(' | ')}`); resolve({ code, out, err }); });
  });
}

const readJson = (f) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return null; } };

export async function runAnalysis({ cfg, root, run, log }) {
  const runDir = run.dir, runRel = relative(root, runDir);
  const outDir = join(runDir, 'analysis');
  mkdirSync(outDir, { recursive: true });
  const errors = [];
  let source = 'fallback';

  if (existsSync(cfg.analysisCli)) {
    source = 'cli';
    const cli = relative(root, cfg.analysisCli);
    const steps = [
      ['cluster', ['--run', runRel], 180_000],
      ['verify', ['--run', runRel, '--game-url', cfg.gameUrl], 600_000],
      ['score', ['--run', runRel, '--ledger', relative(root, cfg.ledgerPath)], 180_000],
      ['report', ['--run', runRel], 180_000],
    ];
    for (const [cmd, args, timeoutMs] of steps) {
      log(`analysis: ${run.meta.runId} → ${cmd}`);
      const r = await sh('node', [cli, cmd, ...args], { cwd: root, timeoutMs, log, label: cmd });
      if (r.code !== 0) errors.push(`${cmd}: exit ${r.code}${r.err ? ` — ${r.err.trim().split('\n').pop()}` : ''}`);
    }
  } else {
    errors.push(`analysis CLI not found at ${cfg.analysisCli}; wrote fallback analysis`);
    log(`analysis: ${run.meta.runId}: ${errors[0]}`);
  }

  // Fill in whatever the CLI did not produce.
  const reports = collectReports(run);
  if (!existsSync(join(outDir, 'findings.json'))) writeFileSync(join(outDir, 'findings.json'), JSON.stringify(fallbackFindings(reports), null, 2));
  if (!existsSync(join(outDir, 'score.json'))) writeFileSync(join(outDir, 'score.json'), JSON.stringify(fallbackScore(reports, readJson(cfg.ledgerPath) ?? []), null, 2));
  if (!existsSync(join(outDir, 'report.md'))) writeFileSync(join(outDir, 'report.md'), fallbackReport(run, reports, source, errors));
  writeFileSync(join(outDir, 'meta.json'), JSON.stringify({ source, errors, at: new Date().toISOString() }, null, 2));
  return { source, errors };
}

export function readAnalysis(runDir) {
  const dir = join(runDir, 'analysis');
  if (!existsSync(join(dir, 'findings.json'))) return null;
  let reportMd = '';
  try { reportMd = readFileSync(join(dir, 'report.md'), 'utf8'); } catch { /* none */ }
  return { findings: readJson(join(dir, 'findings.json')) ?? [], score: readJson(join(dir, 'score.json')), reportMd, meta: readJson(join(dir, 'meta.json')) };
}

/** `ask` → cli.mjs ask --run runs/<id> "question" → stdout. Throws if the CLI is not available. */
export async function ask({ cfg, root, run, question, log }) {
  if (!existsSync(cfg.analysisCli)) throw Object.assign(new Error(`analysis CLI not found at ${relative(root, cfg.analysisCli)} — the ANALYSIS package has not landed`), { status: 503 });
  const r = await sh('node', [relative(root, cfg.analysisCli), 'ask', '--run', relative(root, run.dir), question], { cwd: root, timeoutMs: 300_000, log, label: 'ask' });
  if (r.code !== 0) throw Object.assign(new Error(`ask failed (exit ${r.code}): ${r.err.trim().split('\n').pop() || 'no stderr'}`), { status: 502 });
  return r.out.trim();
}

// ── fallback ──────────────────────────────────────────────────────────────────
function collectReports(run) {
  const out = [];
  for (const p of run.personas.values()) {
    const rep = readJson(join(p.dir, 'report.json'));
    if (rep) out.push({ key: p.key, report: rep });
  }
  return out;
}

function fallbackFindings(reports) {
  const byTitle = new Map();
  for (const { key, report } of reports) {
    for (const f of report.findings ?? []) {
      const k = (f.title ?? '').toLowerCase().trim();
      let c = byTitle.get(k);
      if (!c) {
        c = { id: `cf-${byTitle.size + 1}`, title: f.title, category: f.category, severity: f.severity, description: f.description, room: f.room, reporters: [], attribution: 'unclear', verified: null, verificationNote: 'fallback analysis — not replayed', frames: [] };
        byTitle.set(k, c);
      }
      let r = c.reporters.find((x) => x.persona === key);
      if (!r) c.reporters.push((r = { persona: key, count: 0, findingIds: [] }));
      r.count++; r.findingIds.push(f.id);
      if (f.frame) c.frames.push(`${key}/${f.frame}`);
    }
  }
  for (const c of byTitle.values()) c.attribution = c.reporters.length >= 3 ? 'game' : c.reporters.length === 1 ? 'agent' : 'unclear';
  return [...byTitle.values()];
}

function fallbackScore(reports, ledger) {
  const classes = ['objective', 'confusion', 'familiarity', 'pacing', 'fairness', 'accessibility', 'decoy'];
  const byClass = Object.fromEntries(classes.map((c) => [c, { total: 0, found: 0 }]));
  for (const e of ledger) if (byClass[e.class]) byClass[e.class].total++;
  const all = reports.flatMap((r) => r.report.findings ?? []);
  return {
    recall: 0, precision: 0, byClass, decoysFlagged: [], emergent: [...new Set(all.map((f) => f.title))],
    found: [], missed: ledger.filter((e) => e.class !== 'decoy').map((e) => e.id),
    note: 'fallback score — analysis CLI unavailable; nothing was joined against the ledger',
  };
}

function fallbackReport(run, reports, source, errors) {
  const lines = [`# Playtest report — run ${run.meta.runId}`, '', `_${source === 'cli' ? 'Partial' : 'Fallback'} report assembled by the orchestrator${errors.length ? `; analysis errors: ${errors.join('; ')}` : ''}._`, '',
    `- backend: ${run.meta.backend} · seed: ${run.meta.seed} · personas: ${run.meta.personas.join(', ')} · status: ${run.meta.status}`, ''];
  for (const { key, report } of reports) {
    lines.push(`## ${key} — ${report.completed ? 'completed' : 'did not complete'} · would recommend ${report.wouldRecommend}/5`, '', report.summary ?? '', '');
    if (report.abandonedReason) lines.push(`Abandoned: ${report.abandonedReason}`, '');
    for (const f of report.findings ?? []) lines.push(`- **[${f.severity}] ${f.title}** (${f.category}${f.room ? `, ${f.room}` : ''}) — ${f.description}`);
    lines.push('');
    for (const k of ['confused', 'bored', 'unfair', 'enjoyed']) if (report.experience?.[k]?.length) lines.push(`- ${k}: ${report.experience[k].join('; ')}`);
    lines.push('');
  }
  if (!reports.length) lines.push('_No persona wrote a report._');
  return lines.join('\n');
}
