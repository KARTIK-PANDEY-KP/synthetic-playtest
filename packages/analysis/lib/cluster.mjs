/**
 * Dedup findings across personas into ClusteredFinding[].
 *
 * Tier (a) — deterministic, offline: same room + similar text. Similarity is a blend of
 * title-concept Jaccard and full-text-concept Jaccard (domain synonyms collapsed), plus
 * a bonus for shared *distinctive* bigrams (phrases that appear in findings from ≥2
 * personas but in under 40% of all findings). Average-linkage agglomeration so one
 * chatty description cannot chain unrelated findings together.
 *
 * Tier (b) — `--llm`: one `codex exec --output-schema` call sees every finding and
 * returns cluster assignments; used to refine (a). Falls back to (a) on any failure.
 */
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { conceptSet, domainConcepts, bigrams, jaccard, intersect, normalizeRoom, maxSeverity, mode, severityRank, withDefaults } from './text.mjs';
import { analyzePersona, attribute, DEFAULTS as ATTR_DEFAULTS } from './attribution.mjs';
import { runCodex } from './codex.mjs';

export const CLUSTER_DEFAULTS = { threshold: 0.5, ...ATTR_DEFAULTS };

/** Flatten every persona's findings, with the room resolved from telemetry when missing. */
export function collectFindings(run) {
  const knownRooms = [...new Set(run.personas.flatMap((p) => p.roomsReached()))];
  const items = [];
  for (const p of run.personas) {
    for (const f of p.findings) {
      const t = p.timeAtStep(f.step ?? 0);
      const room = normalizeRoom(f.room, knownRooms) ?? p.roomAt(t) ?? 'unknown';
      items.push({
        key: `${p.id}:${f.id}`, persona: p.id, finding: f, room,
        title: conceptSet(f.title), all: conceptSet(`${f.title} ${f.description}`), concepts: domainConcepts(`${f.title} ${f.description}`),
        titleConcepts: domainConcepts(f.title), grams: bigrams(`${f.title} ${f.description}`),
      });
    }
  }
  // distinctive bigrams: shared by ≥2 personas, present in <40% of findings
  const gramPersonas = new Map(), gramCount = new Map();
  for (const it of items) for (const g of it.grams) { (gramPersonas.get(g) ?? gramPersonas.set(g, new Set()).get(g)).add(it.persona); gramCount.set(g, (gramCount.get(g) ?? 0) + 1); }
  const distinctive = new Set([...gramCount].filter(([g, n]) => gramPersonas.get(g).size >= 2 && n < Math.max(2, items.length * 0.4)).map(([g]) => g));
  for (const it of items) it.distinct = new Set([...it.grams].filter((g) => distinctive.has(g)));
  return items;
}

/** Same room required. Domain concepts (what the finding is ABOUT) weigh most; raw title and
 *  full-text overlap add; shared distinctive phrases add a capped bonus; a concept that is
 *  central to one title but never mentioned anywhere in the other finding costs a little
 *  (two reports of the same thing rarely leave each other's headline concept unmentioned). */
export function similarity(a, b) {
  if (a.room && b.room && a.room !== 'unknown' && b.room !== 'unknown' && a.room !== b.room) return 0;
  const shared = intersect(a.distinct, b.distinct).length;
  const exclusive = [...a.titleConcepts].filter((c) => !b.concepts.has(c)).length + [...b.titleConcepts].filter((c) => !a.concepts.has(c)).length;
  const s = 0.4 * jaccard(a.concepts, b.concepts) + 0.3 * jaccard(a.title, b.title) + 0.3 * jaccard(a.all, b.all) + Math.min(0.3, 0.15 * shared) - Math.min(0.15, 0.05 * exclusive);
  return Math.max(0, Math.min(1, s));
}

/** Average-linkage agglomerative clustering. Returns arrays of item indices. */
export function deterministicClusters(items, threshold = CLUSTER_DEFAULTS.threshold) {
  const n = items.length;
  const sim = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : similarity(items[i], items[j]))));
  let clusters = items.map((_, i) => [i]);
  const avg = (A, B) => A.reduce((s, i) => s + B.reduce((t, j) => t + sim[i][j], 0), 0) / (A.length * B.length);
  for (;;) {
    let best = null;
    for (let i = 0; i < clusters.length; i++) for (let j = i + 1; j < clusters.length; j++) {
      const s = avg(clusters[i], clusters[j]);
      if (s >= threshold && (!best || s > best.s)) best = { i, j, s };
    }
    if (!best) break;
    const merged = [...clusters[best.i], ...clusters[best.j]];
    clusters = clusters.filter((_, k) => k !== best.i && k !== best.j); clusters.push(merged);
  }
  return clusters;
}

/** Build the ClusteredFinding records (without attribution) from index groups. */
export function materialize(items, groups, run) {
  const personasById = Object.fromEntries(run.personas.map((p) => [p.id, p]));
  const out = groups.map((idx) => {
    const members = idx.map((i) => items[i]);
    // representative = medoid by similarity, tie-break longest description
    const rep = members.length === 1 ? members[0] : members.slice().sort((a, b) => {
      const sa = members.reduce((s, m) => s + similarity(a, m), 0), sb = members.reduce((s, m) => s + similarity(b, m), 0);
      return sb - sa || (b.finding.description?.length ?? 0) - (a.finding.description?.length ?? 0);
    })[0];
    const reporters = [];
    for (const m of members) {
      let r = reporters.find((x) => x.persona === m.persona);
      if (!r) reporters.push(r = { persona: m.persona, count: 0, findingIds: [] });
      r.count++; r.findingIds.push(m.finding.id);
    }
    const frames = members.map((m) => (m.finding.frame ? `${m.persona}/${m.finding.frame.replace(/^\.?\//, '')}` : null)).filter(Boolean);
    const reproSteps = rep.finding.reproSteps ?? [];
    return {
      id: '', title: rep.finding.title, category: mode(members.map((m) => m.finding.category), 'other'),
      severity: maxSeverity(members.map((m) => m.finding.severity)), description: rep.finding.description,
      room: rep.room === 'unknown' ? undefined : rep.room,
      reporters, attribution: 'unclear', verified: null, frames,
      reproSteps,
      members: members.map((m) => ({ persona: m.persona, findingId: m.finding.id, step: m.finding.step, severity: m.finding.severity, category: m.finding.category, title: m.finding.title, frame: m.finding.frame })),
    };
  });
  // stable ordering: severity desc, reporter count desc, title
  out.sort((a, b) => severityRank(b.severity) - severityRank(a.severity) || b.reporters.length - a.reporters.length || a.title.localeCompare(b.title));
  out.forEach((c, i) => { c.id = `cf-${String(i + 1).padStart(2, '0')}`; });
  return { clusters: out, personasById };
}

export function attributeAll(clusters, run, opts = {}) {
  const personasById = Object.fromEntries(run.personas.map((p) => [p.id, p]));
  const digests = Object.fromEntries(run.personas.map((p) => [p.id, analyzePersona(p, opts)]));
  for (const c of clusters) {
    const members = c.members.map((m) => ({ persona: m.persona, finding: personasById[m.persona].findings.find((f) => f.id === m.findingId) ?? { step: m.step } }));
    const { attribution, evidence } = attribute({ room: c.room ?? 'unknown', members }, digests, personasById, opts);
    c.attribution = attribution; c.attributionEvidence = evidence;
  }
  return { clusters, digests };
}

/** The whole `cluster` subcommand. */
export async function clusterRun(run, opts = {}) {
  const o = withDefaults(CLUSTER_DEFAULTS, opts);
  const items = collectFindings(run);
  let groups = deterministicClusters(items, o.threshold);
  let tier = 'deterministic';
  if (o.llm && items.length > 1) {
    try { groups = await llmRefine(items, groups, run, o); tier = 'deterministic+llm'; }
    catch (e) { o.log?.(`[cluster] llm refinement failed, keeping deterministic clusters: ${e.message}\n`); }
  }
  const { clusters } = materialize(items, groups, run);
  attributeAll(clusters, run, o);
  return { clusters, tier, rawFindings: items.length };
}

// ── tier (b) ──────────────────────────────────────────────────────────────────
const SCHEMA = {
  type: 'object', additionalProperties: false, required: ['clusters'],
  properties: {
    clusters: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, required: ['title', 'memberKeys'],
        properties: { title: { type: 'string' }, memberKeys: { type: 'array', items: { type: 'string' } } },
      },
    },
  },
};

async function llmRefine(items, groups, run, o) {
  const lines = items.map((it) => `- key=${it.key} persona=${it.persona} room=${it.room} severity=${it.finding.severity} category=${it.finding.category}\n  title: ${it.finding.title}\n  description: ${it.finding.description}`).join('\n');
  const draft = groups.map((g, i) => `cluster ${i + 1}: ${g.map((k) => items[k].key).join(', ')}`).join('\n');
  const prompt = `You are deduplicating playtest findings written by ${run.personas.length} different testers of the same game.
Group findings that describe THE SAME underlying issue (same place in the game, same root cause) even if worded differently
or given different severities. The test: would a developer fix them with the SAME single change? If yes they are one
cluster — five testers saying "the door does nothing", "is it locked?", "E gives no response" about the same doors is ONE
issue (no feedback on locked doors). Wayfinding ("which door leads where") is a DIFFERENT fix and a different cluster.
Do NOT merge findings that merely share a room or a noun. Every key must appear in exactly one cluster.
Return JSON matching the schema: clusters[] with a short neutral title and memberKeys[].

FINDINGS
${lines}

A deterministic first pass proposed these clusters (you may split or merge them):
${draft}`;
  const dir = mkdtempSync(join(tmpdir(), 'sp-cluster-'));
  try {
    const schemaPath = join(dir, 'schema.json'); writeFileSync(schemaPath, JSON.stringify(SCHEMA));
    const { text } = await runCodex({ prompt, cwd: run.dir, schemaPath, effort: 'low', log: o.log });
    const parsed = JSON.parse(text);
    const byKey = new Map(items.map((it, i) => [it.key, i]));
    const used = new Set(); const out = [];
    for (const c of parsed.clusters ?? []) {
      const idx = [...new Set(c.memberKeys)].map((k) => byKey.get(k)).filter((i) => i !== undefined && !used.has(i));
      idx.forEach((i) => used.add(i));
      if (idx.length) out.push(idx);
    }
    items.forEach((_, i) => { if (!used.has(i)) out.push([i]); });   // never lose a finding
    return out;
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
