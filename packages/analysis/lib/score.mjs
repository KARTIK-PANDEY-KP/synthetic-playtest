/**
 * Join clusters to the flaw ledger and compute the Score (contract.ts §Score).
 *
 * Primary key: a `flaw_triggered` / `softlock_entered` telemetry event with that flawId in
 * the reporting persona's session within 5 steps before (1 after) finding.step, in the same
 * room, sharing ≥1 concept with the finding's text (rooms are dense: a flaw firing nearby is
 * not evidence the tester noticed THAT flaw). Several ids are ranked by room + overlap + distance.
 *
 * Secondary key: same room + ≥3 shared title concepts with the ledger entry, adjusted by
 * whether the entry's ground-truth signal ever fired in that persona's session (+1 / −1).
 *
 * recall    = non-decoy ledger flaws matched by ≥1 cluster / all non-decoy flaws
 * precision = clusters matched to a non-decoy flaw / all clusters
 */
import { conceptSet, intersect, normalizeRoom, withDefaults } from './text.mjs';

export const SCORE_DEFAULTS = { stepBefore: 5, stepAfter: 1, minOverlap: 3 };
const FLAW_CLASSES = ['objective', 'confusion', 'familiarity', 'pacing', 'fairness', 'accessibility', 'decoy'];

const ROOM_WORDS = new Set(['airlock', 'corridor', 'power', 'lab', 'greenhous', 'reactor', 'room']);
const keywords = (text) => new Set([...conceptSet(text)].filter((w) => !ROOM_WORDS.has(w)));
const signalId = (entry) => entry.groundTruthSignal?.match(/(?:flaw_triggered|softlock_entered)\s+([A-Z]\d+)/)?.[1] ?? entry.id;

/** Match ONE finding to a ledger entry. Returns { entry, method, score } or null. */
export function matchFinding(finding, persona, room, ledger, opts = {}) {
  const { stepBefore, stepAfter, minOverlap } = withDefaults(SCORE_DEFAULTS, opts);
  const fKeys = keywords(`${finding.title} ${finding.description}`);
  const step = finding.step ?? 0;

  // primary: flaw events near the step
  const near = new Map();
  for (const e of persona.telemetry) {
    if (e.type !== 'flaw_triggered' && e.type !== 'softlock_entered') continue;
    const rel = persona.stepAt(e.t) - step;
    if (rel < -stepBefore || rel > stepAfter) continue;
    const d = Math.abs(rel);
    if (!near.has(e.flawId) || near.get(e.flawId) > d) near.set(e.flawId, d);
  }
  const candidates = ledger.filter((l) => near.has(l.id) || near.has(signalId(l)));
  if (candidates.length) {
    const scored = candidates.map((l) => {
      const overlap = intersect(keywords(l.title), fKeys).length;
      const roomOk = !room || normalizeRoom(l.room) === room;
      const d = near.get(l.id) ?? near.get(signalId(l));
      return { entry: l, overlap, roomOk, score: (roomOk ? 2 : 0) + overlap - 0.1 * d, d };
    }).filter((c) => c.roomOk && c.overlap >= 1).sort((a, b) => b.score - a.score);
    const best = scored[0];
    if (best) return { entry: best.entry, method: 'telemetry', score: best.score, detail: `flaw_triggered ${best.entry.id} fired ${best.d} step(s) from the finding and the text shares ${best.overlap} concept(s) with the ledger title` };
  }

  // secondary: room + keywords
  const fired = new Set(persona.telemetry.filter((e) => e.type === 'flaw_triggered' || e.type === 'softlock_entered').map((e) => e.flawId));
  let best = null;
  for (const l of ledger) {
    if (!room || normalizeRoom(l.room) !== room) continue;
    const overlap = intersect(keywords(l.title), fKeys).length;
    if (overlap < minOverlap) continue;
    const adjusted = overlap + (fired.has(signalId(l)) ? 1 : -1);
    if (adjusted < minOverlap) continue;
    if (!best || adjusted > best.score) best = { entry: l, method: 'keywords', score: adjusted, detail: `room ${room} + ${overlap} shared title concepts${fired.has(signalId(l)) ? ' (and the flaw fired in this session)' : ' (flaw never fired in this session)'}` };
  }
  return best;
}

export function scoreRun(run, clusters, ledger, opts = {}) {
  const personasById = Object.fromEntries(run.personas.map((p) => [p.id, p]));
  const matches = [];
  for (const c of clusters) {
    const votes = new Map();
    for (const m of c.members) {
      const p = personasById[m.persona]; if (!p) continue;
      const f = p.findings.find((x) => x.id === m.findingId); if (!f) continue;
      const r = matchFinding(f, p, c.room ?? null, ledger, opts);
      if (!r) continue;
      const v = votes.get(r.entry.id) ?? { entry: r.entry, n: 0, score: 0, methods: new Set(), details: [] };
      v.n++; v.score += r.score + (r.method === 'telemetry' ? 10 : 0); v.methods.add(r.method); v.details.push(`${m.persona}: ${r.detail}`);
      votes.set(r.entry.id, v);
    }
    const win = [...votes.values()].sort((a, b) => b.score - a.score)[0];
    if (win) {
      c.ledgerId = win.entry.id;
      matches.push({ clusterId: c.id, ledgerId: win.entry.id, class: win.entry.class, method: [...win.methods].join('+'), personas: c.reporters.map((r) => r.persona), detail: win.details });
    } else delete c.ledgerId;
  }

  const nonDecoy = ledger.filter((l) => l.class !== 'decoy');
  const foundSet = new Set(matches.filter((m) => m.class !== 'decoy').map((m) => m.ledgerId));
  const found = nonDecoy.filter((l) => foundSet.has(l.id)).map((l) => l.id);
  const missed = nonDecoy.filter((l) => !foundSet.has(l.id)).map((l) => l.id);
  const decoysFlagged = [...new Set(matches.filter((m) => m.class === 'decoy').map((m) => m.ledgerId))];
  const matchedNonDecoyClusters = clusters.filter((c) => c.ledgerId && ledger.find((l) => l.id === c.ledgerId)?.class !== 'decoy');
  const unmatched = clusters.filter((c) => !c.ledgerId);
  const emergent = unmatched.filter((c) => c.attribution === 'game').map((c) => c.id);

  const byClass = {};
  for (const k of FLAW_CLASSES) {
    const entries = ledger.filter((l) => l.class === k);
    if (!entries.length) continue;
    byClass[k] = { total: entries.length, found: entries.filter((l) => (k === 'decoy' ? decoysFlagged.includes(l.id) : foundSet.has(l.id))).length };
  }

  // Did the ledger's expectedPersonas prediction hold?
  const predictions = ledger.map((l) => {
    const actual = [...new Set(matches.filter((m) => m.ledgerId === l.id).flatMap((m) => m.personas))];
    const expected = l.expectedPersonas ?? [];
    const hit = expected.filter((p) => actual.includes(p));
    const verdict = l.class === 'decoy' ? (actual.length ? 'false-positive' : 'held')
      : !expected.length ? (actual.length ? 'unpredicted' : 'n/a')
        : hit.length === expected.length ? 'held' : hit.length ? 'partial' : 'failed';
    return { ledgerId: l.id, class: l.class, expected, actual, hit, missedPredictions: expected.filter((p) => !actual.includes(p)), unexpected: actual.filter((p) => !expected.includes(p)), verdict };
  });
  const perPersona = {};
  for (const p of run.personas) {
    const predicted = predictions.filter((x) => x.expected.includes(p.id));
    const hits = predicted.filter((x) => x.actual.includes(p.id));
    const reported = predictions.filter((x) => x.actual.includes(p.id) && x.class !== 'decoy').map((x) => x.ledgerId);
    perPersona[p.id] = { predicted: predicted.map((x) => x.ledgerId), hits: hits.map((x) => x.ledgerId), hitRate: predicted.length ? +(hits.length / predicted.length).toFixed(3) : null, reported, unexpected: reported.filter((id) => !predicted.some((x) => x.ledgerId === id)) };
  }

  const score = {
    recall: nonDecoy.length ? +(found.length / nonDecoy.length).toFixed(4) : 0,
    precision: clusters.length ? +(matchedNonDecoyClusters.length / clusters.length).toFixed(4) : 0,
    byClass, decoysFlagged, emergent, found, missed,
    // additive detail beyond contract.ts — safe for consumers that only read the fields above
    totals: { ledger: ledger.length, nonDecoy: nonDecoy.length, clusters: clusters.length, matchedNonDecoy: matchedNonDecoyClusters.length, decoyClusters: clusters.length - matchedNonDecoyClusters.length - unmatched.length, unmatched: unmatched.length },
    matches, unmatched: unmatched.map((c) => ({ clusterId: c.id, title: c.title, attribution: c.attribution, room: c.room })),
    predictions, perPersona,
  };
  return score;
}
