#!/usr/bin/env node
/**
 * End-to-end test of the analysis CLI on fixtures/run-fixture (no network, no model).
 *
 *   cluster → verify (against the mock replay page) → score → report → report --html
 *
 * Runs on a scratch COPY of the fixture so the committed archive stays pristine.
 * Expected numbers are computed by hand from the fixture story (see fixtures/make-fixture.mjs):
 *   16 clusters; 12 map to non-decoy ledger flaws; 1 to decoy D1; 3 unmatched
 *   (emergent power door [game], lab-terminal guessing [agent], fuse purpose [unclear]).
 *   recall    = 12 / 15 non-decoy flaws = 0.8   (missed B2, B4, G2)
 *   precision = 12 / 16 clusters        = 0.75
 */
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { serveMock } from './fixtures/mock-game/serve.mjs';

const HERE = fileURLToPath(new URL('./', import.meta.url));
const CLI = join(HERE, 'cli.mjs');
const FIXTURE = join(HERE, 'fixtures', 'run-fixture');
const LEDGER = join(HERE, 'fixtures', 'ledger.json');

let failures = 0, passes = 0;
const check = (name, ok, detail = '') => { (ok ? passes++ : failures++); console.log(`${ok ? ' ok ' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`); };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
// Async, not spawnSync: this process hosts the mock game server, and a blocked event loop
// would starve every page.goto in the child.
const cli = (...args) => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [CLI, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '', err = '';
  child.stdout.on('data', (d) => { out += d; }); child.stderr.on('data', (d) => { err += d; });
  child.on('close', (code) => { if (code !== 0) { console.error(err); reject(new Error(`cli ${args[0]} exited ${code}`)); } else resolve({ stdout: out, stderr: err }); });
});
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));

const work = mkdtempSync(join(tmpdir(), 'sp-analysis-test-'));
const run = join(work, 'run');
cpSync(FIXTURE, run, { recursive: true });
rmSync(join(run, 'analysis'), { recursive: true, force: true });
const { server, url } = await serveMock();

try {
  // ── fixture sanity ────────────────────────────────────────────────────────
  const meta = readJson(join(run, 'run.json'));
  check('fixture has 5 personas with the full archive layout', meta.personas.length === 5 && meta.personas.every((id) => ['persona.json', 'session.jsonl', 'report.json', 'cost.json', 'frames'].every((f) => existsSync(join(run, id, f)))));
  const costs = meta.personas.map((id) => readJson(join(run, id, 'cost.json')));
  check('per-persona cost is realistic (each $8–$17, budget-consistent steps)', costs.every((c, i) => c.usd >= 8 && c.usd <= 17 && c.steps <= readJson(join(run, meta.personas[i], 'persona.json')).enforcement.step_budget), costs.map((c, i) => `${meta.personas[i]} $${c.usd} ${c.steps} steps`).join(', '));
  const samTel = readFileSync(join(run, 'sam', 'session.jsonl'), 'utf8');
  check('sam hit the B1 soft-lock (softlock_entered in telemetry)', /"type":"softlock_entered","flawId":"B1"/.test(samTel));
  check('no persona session contains the word __telemetry (agent-visible payload hygiene)', meta.personas.every((id) => !/__telemetry/.test(readFileSync(join(run, id, 'session.jsonl'), 'utf8'))));

  // ── cluster ───────────────────────────────────────────────────────────────
  await cli('cluster', '--run', run);
  let findings = readJson(join(run, 'analysis', 'findings.json'));
  check('cluster wrote analysis/findings.json with 16 clusters from 21 findings', findings.length === 16 && findings.reduce((s, c) => s + c.members.length, 0) === 21, `${findings.length} clusters`);
  const byReporters = (ids) => findings.find((c) => eq(c.reporters.map((r) => r.persona).sort(), ids.slice().sort()));
  const c1 = findings.find((c) => c.room === 'airlock' && c.reporters.length === 3);
  check('C1 clusters to ONE finding with 3 reporters (maya, robert, sam)', !!c1 && eq(c1.reporters.map((r) => r.persona).sort(), ['maya', 'robert', 'sam']), c1?.title);
  check('C1 is attributed to the game (4 of 5 stalled at the airlock spawn)', c1?.attribution === 'game' && c1?.attributionEvidence.stalled.length === 4, c1?.attributionEvidence.rule);
  const a1 = findings.find((c) => c.category === 'accessibility');
  check('A1 has dana as its sole reporter', !!a1 && eq(a1.reporters.map((r) => r.persona), ['dana']), a1?.title);
  check('A1 attributed correctly: game, via enforced capability gap (dana has no listen tool; the 4 who passed all used it)', a1?.attribution === 'game' && a1?.attributionEvidence.capabilityGap?.tool === 'listen' && a1?.attributionEvidence.stalled.length === 1 && a1?.attributionEvidence.stalled[0].persona === 'dana', a1?.attributionEvidence.rule);
  const c3 = findings.find((c) => c.room === 'corridor' && c.reporters.length === 3);
  check('C3 clusters maya + robert + priya (robert never found the card; wording differs)', !!c3 && eq(c3.reporters.map((r) => r.persona).sort(), ['maya', 'priya', 'robert']));
  const emergentC = byReporters(['priya', 'dana']);
  check('power-door finding clusters priya + dana and is attributed to the game (5 of 5 stalled)', emergentC?.attribution === 'game' && emergentC?.attributionEvidence.stalled.length === 5, emergentC?.title);
  const terminal = findings.find((c) => /terminal rejects/i.test(c.title));
  check("sam's code-guessing at the lab terminal is attributed to the agent (only he stalled there)", terminal?.attribution === 'agent');
  check('every cluster starts unverified (verified === null) with room + frames', findings.every((c) => c.verified === null && c.room && Array.isArray(c.frames)));

  // ── verify (against the mock replay page implementing window.__replay) ────
  await cli('verify', '--run', run, '--game-url', url);
  findings = readJson(join(run, 'analysis', 'findings.json'));
  const verified = findings.filter((c) => c.verified === true), falsified = findings.filter((c) => c.verified === false), unver = findings.filter((c) => c.verified === null);
  check('verify reproduces ≥12 clusters by replaying the sliced action log at the same seed', verified.length >= 12 && falsified.length === 0, `${verified.length} true / ${falsified.length} false / ${unver.length} null`);
  check('C1 (fires at t=3.5s before the first action) is replay-verified for all 3 reporters', findings.find((c) => c.room === 'airlock' && c.reporters.length === 3)?.verified === true);
  check('unverifiable clusters carry a note and are null, never false', unver.every((c) => c.verified === null && /nothing to replay against/.test(c.verificationNote)));
  // negative paths
  cpSync(join(run, 'analysis', 'findings.json'), join(work, 'findings.bak.json'));
  await cli('verify', '--run', run, '--game-url', `${url}?chaos=nosupport`);
  check('a build without window.__replay → every cluster null with an "unsupported" note', readJson(join(run, 'analysis', 'findings.json')).every((c) => c.verified === null && /unsupported|nothing to replay/.test(c.verificationNote)));
  await cli('verify', '--run', run, '--game-url', `${url}?chaos=drop:C2`);
  const c2 = readJson(join(run, 'analysis', 'findings.json')).find((c) => /calibrate/i.test(c.title));
  check('a build where C2 never fires → the C2 cluster is verified=false (did not reproduce)', c2?.verified === false, c2?.verificationNote);
  cpSync(join(work, 'findings.bak.json'), join(run, 'analysis', 'findings.json'));

  // ── score ─────────────────────────────────────────────────────────────────
  await cli('score', '--run', run, '--ledger', LEDGER);
  const score = readJson(join(run, 'analysis', 'score.json'));
  findings = readJson(join(run, 'analysis', 'findings.json'));
  check('recall = 12/15 = 0.8 exactly', score.recall === 0.8, `${score.recall}`);
  check('precision = 12/16 = 0.75 exactly', score.precision === 0.75, `${score.precision}`);
  check('found = the 12 hand-computed flaws', eq(score.found, ['B1', 'B3', 'C1', 'C2', 'C3', 'C4', 'G1', 'P1', 'P2', 'U1', 'U2', 'A1']), score.found.join(','));
  check('missed = B2, B4, G2', eq(score.missed, ['B2', 'B4', 'G2']), score.missed.join(','));
  check('D1 (robert\'s sealed bulkhead) appears in decoysFlagged; D2 does not', eq(score.decoysFlagged, ['D1']));
  check("priya + dana's power-door finding is the ONLY emergent finding", eq(score.emergent, [emergentC.id]), score.emergent.join(','));
  check('byClass matches the hand count', eq(score.byClass, { objective: { total: 4, found: 2 }, confusion: { total: 4, found: 4 }, familiarity: { total: 2, found: 1 }, pacing: { total: 2, found: 2 }, fairness: { total: 2, found: 2 }, accessibility: { total: 1, found: 1 }, decoy: { total: 2, found: 1 } }));
  check('B1 matched through the secondary key (softlock noted 10+ steps after it fired)', score.matches.find((m) => m.ledgerId === 'B1')?.method === 'keywords' && findings.find((c) => c.ledgerId === 'B1')?.reporters[0].persona === 'sam');
  check('predictions: A1→dana held, C1 held (+sam unexpected), U2 failed (predicted maya/sam, priya found it)', score.predictions.find((p) => p.ledgerId === 'A1').verdict === 'held' && score.predictions.find((p) => p.ledgerId === 'C1').verdict === 'held' && eq(score.predictions.find((p) => p.ledgerId === 'C1').unexpected, ['sam']) && score.predictions.find((p) => p.ledgerId === 'U2').verdict === 'failed');
  check('per-persona hit rate computed (dana 1/5 predicted, robert 3/7)', score.perPersona.dana.hitRate === 0.2 && score.perPersona.robert.hitRate === 0.429);
  check('findings.json now carries ledgerId on matched clusters', findings.filter((c) => c.ledgerId).length === 13);

  // ── report ────────────────────────────────────────────────────────────────
  await cli('report', '--run', run);
  const md = readFileSync(join(run, 'analysis', 'report.md'), 'utf8');
  for (const h of ['## Headline numbers', '## Verified findings', '## Unverified findings', '## Per-persona experience', '## Where the fleet disagreed', '## Scorecard', '## Decoys falsely flagged', '## Emergent findings']) check(`report.md has section "${h}"`, md.includes(h));
  const disagree = md.split('## Where the fleet disagreed')[1].split('## Scorecard')[0];
  check('"Where the fleet disagreed" explains A1 through Dana and sound', /Dana/.test(disagree) && /sound off/i.test(disagree) && /listen/.test(disagree));
  check('…and explains B1 through the route (sam reached the lab before the power room)', /Route: Sam reached the lab before the power room/.test(disagree));
  check('…and explains G1 through genre familiarity (robert none vs the rest)', /Genre familiarity separates them: Robert/.test(disagree));
  check('verified findings come first, severity-descending, with reporters and repro steps', md.indexOf('## Verified findings') < md.indexOf('## Unverified findings') && /### 1\. /.test(md) && /Repro steps:/.test(md) && /Reported by /.test(md));
  check('headline line carries recall/precision', /Recall \*\*80%\*\*/.test(md) && /Precision \*\*75%\*\*/.test(md));
  check('per-persona section is in their voice (summary quotes) with enforcement', /> Fast start, then a pixel hunt/.test(md) && /audio off/.test(md));
  check('decoy section names D1 and robert', /\*\*D1\*\*.*robert/.test(md));

  await cli('report', '--run', run, '--html');
  const html = readFileSync(join(run, 'analysis', 'report.html'), 'utf8');
  check('report.html is standalone (no external http(s) resources)', !/(src|href)=["']https?:/.test(html));
  check('report.html embeds frame thumbnails as base64 PNG', (html.match(/data:image\/png;base64,/g) ?? []).length >= 10);
  check('report.html is dark-themed with big type for a projector', /--bg:#0b0f14/.test(html) && /font:20px/.test(html) && /Where the fleet disagreed/.test(html));

  // ── hygiene ───────────────────────────────────────────────────────────────
  const walk = (d) => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? (f === 'node_modules' ? [] : walk(p)) : [p]; });
  const forbidden = new RegExp(['brain', 'base'].join(''), 'i');   // assembled so this file does not match itself
  const offenders = walk(HERE).filter((p) => /\.(mjs|json|md|html)$/.test(p) && forbidden.test(readFileSync(p, 'utf8')));
  check('the forbidden word appears nowhere in packages/analysis', offenders.length === 0, offenders.join(','));
} finally {
  server.close();
  rmSync(work, { recursive: true, force: true });
}

console.log(`\n${passes}/${passes + failures} passed`);
process.exit(failures ? 1 : 0);
