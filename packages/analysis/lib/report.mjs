/**
 * The cross-persona playtest report a game developer actually reads.
 * One model → two renderers (Markdown, standalone dark-theme HTML for a 1280×720 projector).
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { analyzePersona } from './attribution.mjs';
import { severityRank } from './text.mjs';

const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const money = (n) => `$${(n ?? 0).toFixed(2)}`;
const pct = (x) => (x == null ? '—' : `${(x * 100).toFixed(0)}%`);
const list = (xs, fallback = 'none') => (xs?.length ? xs.join(', ') : fallback);
const bySeverity = (a, b) => severityRank(b.severity) - severityRank(a.severity) || b.reporters.length - a.reporters.length;
const ROOM_LABEL = { airlock: 'airlock', corridor: 'corridor', power: 'power room', lab: 'lab', greenhouse: 'greenhouse', reactor: 'reactor' };
const roomLabel = (r) => ROOM_LABEL[r] ?? r ?? 'unknown';

// ── model ─────────────────────────────────────────────────────────────────────
export function buildModel(run, clusters, score) {
  const personas = run.personas.map((p) => {
    const steps = p.cost?.steps ?? p.inputActions.length;
    const usd = p.cost?.usd ?? 0;
    const digest = analyzePersona(p);
    return {
      id: p.id, name: p.name, config: p.config, enforcement: p.enforcement, status: p.status, steps, toolCalls: p.actions.length, usd,
      report: p.report, findings: p.findings.length, rooms: digest.rooms, lastRoom: digest.lastRoom, digest,
    };
  });
  const byId = Object.fromEntries(personas.map((p) => [p.id, p]));
  const sorted = clusters.slice().sort(bySeverity);
  const verified = sorted.filter((c) => c.verified === true);
  const unverified = sorted.filter((c) => c.verified !== true);
  const classOf = Object.fromEntries((score?.predictions ?? []).map((p) => [p.ledgerId, p.class]));
  const roomOrder = Object.fromEntries(run.personas.map((p) => [p.id, p.telemetry.filter((e) => e.type === 'room_entered').map((e) => e.room).filter((r, i, a) => a.indexOf(r) === i)]));
  const disagreements = clusters.filter((c) => !c.ledgerId || classOf[c.ledgerId] !== 'decoy').map((c) => disagreement(c, personas, byId, score, classOf[c.ledgerId], roomOrder)).filter(Boolean).sort((a, b) => bySeverity(a.cluster, b.cluster));
  const ledgerById = Object.fromEntries((score?.predictions ?? []).map((p) => [p.ledgerId, p]));
  return {
    run: run.meta, runDir: run.dir, personas, clusters: sorted, verified, unverified, disagreements, score,
    decoys: score ? clusters.filter((c) => c.ledgerId && score.decoysFlagged.includes(c.ledgerId)) : [],
    emergent: score ? clusters.filter((c) => score.emergent.includes(c.id)) : clusters.filter((c) => !c.ledgerId && c.attribution === 'game'),
    agentFault: clusters.filter((c) => c.attribution === 'agent'),
    headline: {
      personas: personas.length, steps: personas.reduce((s, p) => s + p.steps, 0), toolCalls: personas.reduce((s, p) => s + p.toolCalls, 0),
      usd: personas.reduce((s, p) => s + p.usd, 0), rawFindings: personas.reduce((s, p) => s + p.findings, 0), clusters: clusters.length,
      verified: verified.length, falsified: clusters.filter((c) => c.verified === false).length, unverifiable: clusters.filter((c) => c.verified == null).length,
      game: clusters.filter((c) => c.attribution === 'game').length, agent: clusters.filter((c) => c.attribution === 'agent').length,
      completed: personas.filter((p) => p.report?.completed).length,
      recall: score?.recall ?? null, precision: score?.precision ?? null,
    },
    ledgerById,
  };
}

const DIMS = ['audio', 'reading', 'genre_familiarity', 'patience', 'exploration'];
const names = (ids, byId) => ids.map((id) => byId[id]?.name?.split(' ')[0] ?? id);
const joinNames = (xs) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

/** Which enforcement dimensions plausibly explain a flaw of this class/category. A lone reporter is
 *  separable from the rest on SOME dimension by chance, so a dimension only counts as a reason when it
 *  is relevant to the kind of flaw — or when two or more reporters share the value. */
const RELEVANT = {
  audio: (cls, cat) => cls === 'accessibility' || cat === 'accessibility',
  genre_familiarity: (cls, cat) => cls === 'familiarity' || (!cls && cat === 'confusion'),
  reading: (cls, cat) => cls === 'confusion' || cls === 'fairness' || (!cls && cat === 'confusion'),
  patience: (cls, cat) => cls === 'pacing' || cat === 'boredom',
  exploration: (cls, cat) => cls === 'confusion' || cls === 'pacing' || cat === 'boredom',
};

/** Why did only some personas report this? Reasons are inferred from persona ENFORCEMENT + telemetry, never from self-report. */
function disagreement(c, personas, byId, score, ledgerClass, roomOrder) {
  const room = c.room;
  const reporters = c.reporters.map((r) => r.persona);
  const reached = personas.filter((p) => !room || p.rooms.includes(room)).map((p) => p.id);
  const nonReporters = reached.filter((id) => !reporters.includes(id));
  const neverReached = personas.filter((p) => room && !p.rooms.includes(room)).map((p) => p.id);
  if (!nonReporters.length && !neverReached.length) return null;              // everyone who got there wrote it up
  if (reporters.length === 0) return null;
  const stalledSilent = (c.attributionEvidence?.stalled ?? []).map((s) => s.persona).filter((id) => !reporters.includes(id));
  const reasons = [];
  const gap = c.attributionEvidence?.capabilityGap;
  if (gap) {
    const lone = byId[gap.staller];
    const others = names(gap.comparedTo, byId);
    if (gap.tool === 'listen') reasons.push(`${lone.name} never got the information — ${lone.name.split(' ')[0]} plays with the sound off (audio: off), so the \`listen\` tool does not exist for this persona; ${joinNames(others)} all used \`listen\` in the ${roomLabel(room)} and moved on.`);
    else reasons.push(`${lone.name} never used \`${gap.tool}\` anywhere in the session; ${joinNames(others)} all used it in the ${roomLabel(room)}. ${gap.why}.`);
  }
  // Route: did every reporter reach some other room BEFORE this one while no non-reporter did? (sequence breaks)
  if (room && nonReporters.length && roomOrder) {
    const before = (id, q) => { const o = roomOrder[id] ?? []; const a = o.indexOf(q), b = o.indexOf(room); return a >= 0 && b >= 0 && a < b; };
    for (const q of Object.keys(ROOM_LABEL)) {
      if (q === room) continue;
      if (reporters.every((id) => (roomOrder[id] ?? []).includes(q) && !before(id, q)) && nonReporters.some((id) => before(id, q)) && nonReporters.every((id) => before(id, q) || !(roomOrder[id] ?? []).includes(q))) {
        reasons.push(`Route: ${joinNames(names(reporters, byId))} reached the ${roomLabel(room)} before the ${roomLabel(q)}; ${joinNames(names(nonReporters.filter((id) => before(id, q)), byId))} did it the other way round — this is a sequence-order flaw.`);
      }
    }
  }
  if (nonReporters.length) {
    for (const dim of DIMS) {
      if (gap && dim === 'audio' && gap.tool === 'listen') continue;   // already said, with evidence
      if (!RELEVANT[dim](ledgerClass, c.category) && reporters.length < 2) continue;
      const rv = new Set(reporters.map((id) => byId[id]?.enforcement?.[dim]));
      const nv = new Set(nonReporters.map((id) => byId[id]?.enforcement?.[dim]));
      if (rv.size === 1 && ![...rv].some((v) => nv.has(v))) {
        const v = [...rv][0];
        const R = joinNames(names(reporters, byId)), NR = joinNames(names(nonReporters, byId));
        if (dim === 'audio') reasons.push(v === 'off' ? `${R} play${reporters.length > 1 ? '' : 's'} with sound off; ${NR} could hear.` : `Only the personas with sound on (${R}) reported this; ${NR} play with sound off and never got the cue.`);
        else if (dim === 'genre_familiarity') reasons.push(`Genre familiarity separates them: ${R} ${reporters.length > 1 ? 'have' : 'has'} \`${v}\` familiarity with games like this, while ${NR} (${[...nv].join('/')}) ${v === 'none' ? 'already knew the convention the game never teaches' : 'did not'}.`);
        else if (dim === 'reading') reasons.push(`Reading level separates them: ${R} read${reporters.length > 1 ? '' : 's'} at \`${v}\` (text beyond the budget is blurred out of their screenshots), ${NR} at ${[...nv].map((x) => `\`${x}\``).join('/')}.`);
        else if (dim === 'exploration') reasons.push(`Exploration separates them: ${R} explore${reporters.length > 1 ? '' : 's'} \`${v}\`; ${NR} ${[...nv].map((x) => `\`${x}\``).join('/')}.`);
      }
    }
    const rp = reporters.map((id) => byId[id]?.enforcement?.patience).filter((x) => x != null), np = nonReporters.map((id) => byId[id]?.enforcement?.patience).filter((x) => x != null);
    if (rp.length && np.length && (RELEVANT.patience(ledgerClass, c.category) || reporters.length >= 2)) {
      if (Math.max(...rp) < Math.min(...np)) reasons.push(`Patience separates them: the personas who flagged it are the least patient (patience ≤ ${Math.max(...rp)}); the patient ones (≥ ${Math.min(...np)}) put up with it.`);
      else if (Math.min(...rp) > Math.max(...np)) reasons.push(`Patience separates them the other way: only the most patient personas (patience ≥ ${Math.min(...rp)}) stayed long enough to hit it.`);
    }
  }
  if (neverReached.length) reasons.push(`${joinNames(names(neverReached, byId))} never reached the ${roomLabel(room)} (${neverReached.map((id) => `${byId[id].name.split(' ')[0]} ${byId[id].report?.completed ? 'finished' : 'stopped'} in the ${roomLabel(byId[id].lastRoom)}`).join('; ')}).`);
  if (stalledSilent.length) reasons.push(`${joinNames(names(stalledSilent, byId))} also stalled at this spot by telemetry but did not write it up.`);
  if (!reasons.length) reasons.push('No single persona setting separates reporters from non-reporters here — the difference looks like luck of the route, not enforcement.');
  const pred = score?.predictions?.find((p) => p.ledgerId === c.ledgerId);
  return { cluster: c, reporters, nonReporters, neverReached, stalledSilent, reasons, prediction: pred };
}

// ── markdown ──────────────────────────────────────────────────────────────────
function findingMd(c, model, i) {
  const rep = c.reporters.map((r) => `${r.persona}${r.count > 1 ? ` ×${r.count}` : ''}`).join(', ');
  const attr = c.attribution + (c.attributionEvidence?.capabilityGap ? ` — capability gap: \`${c.attributionEvidence.capabilityGap.tool}\`` : '');
  const lines = [
    `### ${i}. ${c.title}`,
    `**${cap(c.severity)}** · ${c.category} · room: ${c.room ?? 'unknown'}${c.ledgerId ? ` · ledger **${c.ledgerId}**` : ' · not in ledger'} · attribution: **${attr}**`,
    `Reported by ${rep} (${c.reporters.length} of ${model.personas.length} personas). ${c.attributionEvidence?.rule ?? ''}`,
    '', c.description, '',
  ];
  if (c.reproSteps?.length) lines.push('Repro steps:', ...c.reproSteps.map((s, k) => `${k + 1}. ${s}`), '');
  if (c.verificationNote) lines.push(`Verification: ${c.verificationNote}`, '');
  if (c.frames?.length) lines.push(`Frames: ${c.frames.map((f) => `\`${f}\``).join(', ')}`, '');
  return lines.join('\n');
}

export function renderMarkdown(m) {
  const h = m.headline; const out = [];
  out.push(`# Station Kepler — cross-persona playtest report`, '', `Run \`${m.run.runId}\` · seed ${m.run.seed} · ${m.run.backend} · ${m.run.startedAt || ''}`, '');
  out.push('## Headline numbers', '');
  out.push(`| Personas | Steps | Tool calls | Cost | Findings (raw → clustered) | Verified | Attributed to game / agent | Completed |`, `|---|---|---|---|---|---|---|---|`,
    `| ${h.personas} | ${h.steps} | ${h.toolCalls} | ${money(h.usd)} | ${h.rawFindings} → ${h.clusters} | ${h.verified} verified · ${h.falsified} not reproduced · ${h.unverifiable} unverifiable | ${h.game} / ${h.agent} | ${h.completed}/${h.personas} |`, '');
  if (m.score) out.push(`**Recall ${pct(h.recall)}** (${m.score.found.length}/${m.score.totals.nonDecoy} injected flaws found) · **Precision ${pct(h.precision)}** (${m.score.totals.matchedNonDecoy}/${m.score.totals.clusters} clusters map to a real injected flaw) · decoys falsely flagged: ${list(m.score.decoysFlagged)} · emergent: ${m.score.emergent.length}`, '');

  out.push('## Verified findings', '', m.verified.length ? 'Replaying the recorded inputs at the same seed reproduced the same ground-truth signal.' : (h.falsified + h.unverifiable === h.clusters && h.clusters ? '_No finding has been replay-verified yet — run `verify --game-url` against a build with replay mode._' : '_None._'), '');
  m.verified.forEach((c, i) => out.push(findingMd(c, m, i + 1)));
  out.push('## Unverified findings', '', m.unverified.length ? 'Not yet replayed, could not be replayed, or did not reproduce. Severity order.' : '_None — everything reproduced._', '');
  m.unverified.forEach((c, i) => out.push(findingMd(c, m, m.verified.length + i + 1)));

  out.push('## Per-persona experience', '');
  for (const p of m.personas) {
    const e = p.enforcement; const r = p.report;
    out.push(`### ${p.name} (${p.id}) — ${r?.completed ? 'finished' : `stopped in the ${roomLabel(p.lastRoom)}`}, ${p.steps} steps, ${money(p.usd)}, would recommend ${r?.wouldRecommend ?? '—'}/5`);
    out.push(`_reading ${e.reading} · familiarity ${e.genre_familiarity} · patience ${e.patience} · exploration ${e.exploration} · audio ${e.audio}_`, '');
    if (r?.summary) out.push(`> ${r.summary}`, '');
    if (r?.abandonedReason) out.push(`Abandoned: ${r.abandonedReason}`, '');
    for (const k of ['confused', 'bored', 'unfair', 'enjoyed']) if (r?.experience?.[k]?.length) out.push(`- **${cap(k)}:** ${r.experience[k].join(' · ')}`);
    out.push(`- Rooms reached: ${list(p.rooms)}`, '');
  }

  out.push('## Where the fleet disagreed', '', 'Flaws only some personas hit — and why, read from persona enforcement and ground-truth telemetry, not from what the agents said about themselves.', '');
  if (!m.disagreements.length) out.push('_Every finding was reported by everyone who reached its room._', '');
  for (const d of m.disagreements) {
    const c = d.cluster;
    out.push(`### ${c.title}${c.ledgerId ? ` (${c.ledgerId})` : ''}`);
    const byIdM = Object.fromEntries(m.personas.map((p) => [p.id, p]));
    out.push(`Reported by **${joinNames(names(d.reporters, byIdM))}**${d.nonReporters.length ? `; not by ${joinNames(names(d.nonReporters, byIdM))}, who also reached the ${roomLabel(c.room)}` : ` — everyone who reached the ${roomLabel(c.room)}`}${d.neverReached.length ? `; ${d.neverReached.length} never got there` : ''}.`, '');
    for (const r of d.reasons) out.push(`- ${r}`);
    if (d.prediction?.expected?.length) out.push(`- Ledger predicted: ${d.prediction.expected.join(', ')} → verdict **${d.prediction.verdict}**${d.prediction.unexpected.length ? ` (unexpected: ${d.prediction.unexpected.join(', ')})` : ''}.`);
    out.push('');
  }

  if (m.score) {
    const s = m.score;
    out.push('## Scorecard', '', `Recall **${pct(s.recall)}** · Precision **${pct(s.precision)}** · Found ${s.found.length} · Missed ${s.missed.length} (${list(s.missed)}) · Decoys flagged ${s.decoysFlagged.length} · Emergent ${s.emergent.length}`, '');
    out.push('| Class | Found / Total |', '|---|---|');
    for (const [k, v] of Object.entries(s.byClass)) out.push(`| ${k}${k === 'decoy' ? ' (flagged = false positive)' : ''} | ${v.found} / ${v.total} |`);
    out.push('', '| Flaw | Class | Found by | Predicted | Verdict |', '|---|---|---|---|---|');
    for (const p of s.predictions) out.push(`| ${p.ledgerId} | ${p.class} | ${list(p.actual, '—')} | ${list(p.expected, '—')} | ${p.verdict} |`);
    out.push('', '| Persona | Predicted to catch | Caught of those | Hit rate | Also caught (unpredicted) |', '|---|---|---|---|---|');
    for (const [id, v] of Object.entries(s.perPersona)) out.push(`| ${id} | ${list(v.predicted, '—')} | ${list(v.hits, '—')} | ${v.hitRate == null ? '—' : pct(v.hitRate)} | ${list(v.unexpected, '—')} |`);
    out.push('');
    out.push('## Decoys falsely flagged', '');
    if (!m.decoys.length) out.push('_None — no persona reported an intentional design decision as a bug._', '');
    for (const c of m.decoys) out.push(`- **${c.ledgerId}** — "${c.title}" reported by ${c.reporters.map((r) => r.persona).join(', ')} (${c.severity}). This behaviour is intentional and correct; the report is a false positive and counts against precision.`);
    if (m.decoys.length) out.push('');
    out.push('## Emergent findings', '', 'Not in the answer key, but ≥ the game-attribution share of personas stalled at the same spot — real-looking issues the developer did not plan. Triage these by hand.', '');
    if (!m.emergent.length) out.push('_None._', '');
    for (const c of m.emergent) out.push(`- **${c.title}** (${c.severity}, ${c.room}) — reported by ${c.reporters.map((r) => r.persona).join(', ')}; ${c.attributionEvidence?.rule ?? ''}`);
    if (m.emergent.length) out.push('');
  }
  if (m.agentFault.length) {
    out.push('## Attributed to the agent, not the game', '');
    for (const c of m.agentFault) out.push(`- **${c.title}** (${c.room}) — only ${c.reporters.map((r) => r.persona).join(', ')} stalled here; ${c.attributionEvidence?.rule ?? ''}`);
    out.push('');
  }
  return out.join('\n');
}

// ── html ──────────────────────────────────────────────────────────────────────
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const inline = (s) => esc(s).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

function thumb(runDir, rel) {
  const p = join(runDir, rel);
  if (!existsSync(p)) return '';
  const b64 = readFileSync(p).toString('base64');
  return `<figure><img src="data:image/png;base64,${b64}" alt="${esc(rel)}" /><figcaption>${esc(rel)}</figcaption></figure>`;
}

function findingHtml(c, m, i) {
  const gap = c.attributionEvidence?.capabilityGap;
  return `<article class="finding sev-${c.severity}">
  <header><span class="num">${i}</span><h3>${esc(c.title)}</h3></header>
  <p class="meta"><span class="pill sev">${esc(c.severity)}</span><span class="pill">${esc(c.category)}</span><span class="pill">${esc(c.room ?? 'unknown')}</span>${c.ledgerId ? `<span class="pill ledger">ledger ${esc(c.ledgerId)}</span>` : '<span class="pill">not in ledger</span>'}<span class="pill attr-${c.attribution}">${esc(c.attribution)}${gap ? ` · gap: ${esc(gap.tool)}` : ''}</span><span class="pill ${c.verified === true ? 'ok' : c.verified === false ? 'bad' : ''}">${c.verified === true ? 'replay-verified' : c.verified === false ? 'did not reproduce' : 'unverified'}</span></p>
  <p class="reporters">Reported by <strong>${esc(c.reporters.map((r) => `${r.persona}${r.count > 1 ? ` ×${r.count}` : ''}`).join(', '))}</strong> — ${c.reporters.length} of ${m.personas.length} personas. <span class="rule">${esc(c.attributionEvidence?.rule ?? '')}</span></p>
  <p>${esc(c.description)}</p>
  ${c.reproSteps?.length ? `<ol class="repro">${c.reproSteps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>` : ''}
  ${c.verificationNote ? `<p class="note">Verification: ${esc(c.verificationNote)}</p>` : ''}
  ${c.frames?.length ? `<div class="frames">${c.frames.slice(0, 6).map((f) => thumb(m.runDir, f)).join('')}</div>` : ''}
</article>`;
}

export function renderHtml(m) {
  const h = m.headline; const byId = Object.fromEntries(m.personas.map((p) => [p.id, p]));
  const tile = (label, value, sub = '') => `<div class="tile"><div class="v">${value}</div><div class="l">${label}</div>${sub ? `<div class="s">${sub}</div>` : ''}</div>`;
  const sections = [];
  sections.push(`<section class="tiles">
    ${tile('personas', h.personas)}${tile('steps', h.steps, `${h.toolCalls} tool calls`)}${tile('cost', money(h.usd))}${tile('findings', `${h.rawFindings} → ${h.clusters}`, 'raw → clustered')}
    ${tile('verified', h.verified, `${h.falsified} not reproduced · ${h.unverifiable} unverifiable`)}${tile('game / agent', `${h.game} / ${h.agent}`, 'attribution')}
    ${m.score ? tile('recall', pct(h.recall), `${m.score.found.length}/${m.score.totals.nonDecoy} injected flaws`) + tile('precision', pct(h.precision), `${m.score.totals.matchedNonDecoy}/${m.score.totals.clusters} clusters`) : ''}
  </section>`);
  sections.push(`<section><h2>Verified findings</h2>${m.verified.length ? m.verified.map((c, i) => findingHtml(c, m, i + 1)).join('') : '<p class="muted">No finding has been replay-verified yet — run <code>verify --game-url</code> against a build with replay mode.</p>'}</section>`);
  sections.push(`<section><h2>Unverified findings</h2>${m.unverified.length ? m.unverified.map((c, i) => findingHtml(c, m, m.verified.length + i + 1)).join('') : '<p class="muted">None — everything reproduced.</p>'}</section>`);
  sections.push(`<section><h2>Per-persona experience</h2><div class="personas">${m.personas.map((p) => {
    const r = p.report, e = p.enforcement;
    return `<article class="persona"><h3>${esc(p.name)} <small>${esc(p.id)}</small></h3>
      <p class="meta"><span class="pill">${r?.completed ? 'finished' : `stopped in the ${esc(roomLabel(p.lastRoom))}`}</span><span class="pill">${p.steps} steps</span><span class="pill">${money(p.usd)}</span><span class="pill">recommend ${r?.wouldRecommend ?? '—'}/5</span></p>
      <p class="enf">reading ${esc(e.reading)} · familiarity ${esc(e.genre_familiarity)} · patience ${esc(e.patience)} · exploration ${esc(e.exploration)} · audio <strong>${esc(e.audio)}</strong></p>
      ${r?.summary ? `<blockquote>${esc(r.summary)}</blockquote>` : ''}
      ${r?.abandonedReason ? `<p class="note">Abandoned: ${esc(r.abandonedReason)}</p>` : ''}
      <ul>${['confused', 'bored', 'unfair', 'enjoyed'].filter((k) => r?.experience?.[k]?.length).map((k) => `<li><strong>${cap(k)}:</strong> ${esc(r.experience[k].join(' · '))}</li>`).join('')}<li><strong>Rooms:</strong> ${esc(list(p.rooms))}</li></ul></article>`;
  }).join('')}</div></section>`);
  sections.push(`<section class="disagree"><h2>Where the fleet disagreed</h2><p class="lede">Flaws only some personas hit — and why, read from persona enforcement and ground-truth telemetry, never from self-report.</p>
    ${m.disagreements.length ? m.disagreements.map((d) => `<article><h3>${esc(d.cluster.title)}${d.cluster.ledgerId ? ` <span class="pill ledger">${esc(d.cluster.ledgerId)}</span>` : ''}</h3>
      <p><strong>${esc(joinNames(names(d.reporters, byId)))}</strong> reported it${d.nonReporters.length ? `; ${esc(joinNames(names(d.nonReporters, byId)))} also reached the ${esc(roomLabel(d.cluster.room))} and did not` : ` — everyone who reached the ${esc(roomLabel(d.cluster.room))}`}${d.neverReached.length ? `; ${d.neverReached.length} never got there` : ''}.</p>
      <ul>${d.reasons.map((r) => `<li>${inline(r)}</li>`).join('')}${d.prediction?.expected?.length ? `<li>Ledger predicted ${esc(d.prediction.expected.join(', '))} → <strong>${esc(d.prediction.verdict)}</strong>${d.prediction.unexpected.length ? ` (unexpected: ${esc(d.prediction.unexpected.join(', '))})` : ''}.</li>` : ''}</ul></article>`).join('') : '<p class="muted">Every finding was reported by everyone who reached its room.</p>'}</section>`);
  if (m.score) {
    const s = m.score;
    sections.push(`<section><h2>Scorecard</h2>
      <p class="lede">Recall <strong>${pct(s.recall)}</strong> · Precision <strong>${pct(s.precision)}</strong> · missed: ${esc(list(s.missed))} · decoys flagged: ${esc(list(s.decoysFlagged))} · emergent: ${s.emergent.length}</p>
      <div class="cols"><table><thead><tr><th>Class</th><th>Found / total</th></tr></thead><tbody>${Object.entries(s.byClass).map(([k, v]) => `<tr><td>${esc(k)}${k === 'decoy' ? ' <small>(flagged = false positive)</small>' : ''}</td><td>${v.found} / ${v.total}</td></tr>`).join('')}</tbody></table>
      <table><thead><tr><th>Persona</th><th>Predicted</th><th>Caught</th><th>Hit rate</th><th>Unpredicted</th></tr></thead><tbody>${Object.entries(s.perPersona).map(([id, v]) => `<tr><td>${esc(id)}</td><td>${esc(list(v.predicted, '—'))}</td><td>${esc(list(v.hits, '—'))}</td><td>${v.hitRate == null ? '—' : pct(v.hitRate)}</td><td>${esc(list(v.unexpected, '—'))}</td></tr>`).join('')}</tbody></table></div>
      <table class="wide"><thead><tr><th>Flaw</th><th>Class</th><th>Found by</th><th>Predicted</th><th>Verdict</th></tr></thead><tbody>${s.predictions.map((p) => `<tr class="v-${esc(p.verdict)}"><td>${esc(p.ledgerId)}</td><td>${esc(p.class)}</td><td>${esc(list(p.actual, '—'))}</td><td>${esc(list(p.expected, '—'))}</td><td>${esc(p.verdict)}</td></tr>`).join('')}</tbody></table></section>`);
    sections.push(`<section><h2>Decoys falsely flagged</h2>${m.decoys.length ? `<ul>${m.decoys.map((c) => `<li><strong>${esc(c.ledgerId)}</strong> — “${esc(c.title)}” by ${esc(c.reporters.map((r) => r.persona).join(', '))} (${esc(c.severity)}). Intentional and correct; counts against precision.</li>`).join('')}</ul>` : '<p class="muted">None — no persona reported an intentional design decision as a bug.</p>'}</section>`);
    sections.push(`<section><h2>Emergent findings</h2><p class="lede">Not in the answer key, yet enough personas stalled at the same spot to attribute it to the game.</p>${m.emergent.length ? `<ul>${m.emergent.map((c) => `<li><strong>${esc(c.title)}</strong> (${esc(c.severity)}, ${esc(c.room)}) — ${esc(c.reporters.map((r) => r.persona).join(', '))}; ${esc(c.attributionEvidence?.rule ?? '')}</li>`).join('')}</ul>` : '<p class="muted">None.</p>'}</section>`);
  }
  if (m.agentFault.length) sections.push(`<section><h2>Attributed to the agent, not the game</h2><ul>${m.agentFault.map((c) => `<li><strong>${esc(c.title)}</strong> (${esc(c.room)}) — only ${esc(c.reporters.map((r) => r.persona).join(', '))} stalled here; ${esc(c.attributionEvidence?.rule ?? '')}</li>`).join('')}</ul></section>`);

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Station Kepler — cross-persona playtest report</title>
<style>
:root{color-scheme:dark;--bg:#0b0f14;--panel:#121923;--line:#223040;--fg:#e8eef5;--muted:#8fa3b8;--accent:#5ec8ff;--ok:#4ade80;--bad:#f87171;--warn:#fbbf24;--crit:#ff5c7a;--high:#ff9f43;--med:#fbbf24;--low:#8fa3b8}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:20px/1.5 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:1200px;margin:0 auto;padding:32px 40px 80px}
h1{font-size:44px;margin:0 0 6px;letter-spacing:-.5px}h2{font-size:32px;margin:56px 0 16px;border-bottom:2px solid var(--line);padding-bottom:8px;color:var(--accent)}h3{font-size:24px;margin:0}
.sub{color:var(--muted);font-size:18px;margin:0 0 24px}.lede,.muted{color:var(--muted)}
.tiles{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-top:24px}.tile{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:16px 18px}.tile .v{font-size:40px;font-weight:700;letter-spacing:-1px}.tile .l{color:var(--muted);text-transform:uppercase;font-size:13px;letter-spacing:1.5px}.tile .s{color:var(--muted);font-size:14px;margin-top:2px}
.finding{background:var(--panel);border:1px solid var(--line);border-left:8px solid var(--low);border-radius:12px;padding:18px 22px;margin:14px 0}.finding.sev-critical{border-left-color:var(--crit)}.finding.sev-high{border-left-color:var(--high)}.finding.sev-medium{border-left-color:var(--med)}
.finding header{display:flex;gap:14px;align-items:baseline}.num{color:var(--muted);font-size:20px;font-variant-numeric:tabular-nums}
.meta{display:flex;flex-wrap:wrap;gap:8px;margin:10px 0}.pill{display:inline-block;background:#1b2635;border:1px solid var(--line);border-radius:999px;padding:2px 12px;font-size:15px;color:var(--fg)}.pill.sev{text-transform:uppercase;font-weight:700}.sev-critical .pill.sev{color:var(--crit)}.sev-high .pill.sev{color:var(--high)}.sev-medium .pill.sev{color:var(--med)}.pill.ledger{color:var(--accent);border-color:var(--accent)}.pill.attr-game{color:var(--ok);border-color:var(--ok)}.pill.attr-agent{color:var(--bad);border-color:var(--bad)}.pill.attr-unclear{color:var(--warn)}.pill.ok{color:var(--ok)}.pill.bad{color:var(--bad)}
.reporters{margin:4px 0 8px}.rule{color:var(--muted);font-size:16px}.note{color:var(--muted);font-size:16px}.repro{margin:8px 0 8px 22px;font-size:17px}.repro li{margin:2px 0}
.frames{display:flex;gap:10px;flex-wrap:wrap;margin-top:10px}figure{margin:0;text-align:center}figure img{width:96px;height:54px;object-fit:cover;image-rendering:pixelated;border-radius:6px;border:1px solid var(--line);display:block}figcaption{font-size:11px;color:var(--muted);margin-top:2px}
.personas{display:grid;grid-template-columns:repeat(auto-fit,minmax(360px,1fr));gap:14px}.persona{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:16px 20px;font-size:17px}.persona h3 small{color:var(--muted);font-weight:400;font-size:15px}.enf{color:var(--muted);font-size:15px}blockquote{margin:8px 0;padding:8px 14px;border-left:4px solid var(--accent);color:#cfe3f5;font-style:italic}.persona ul{margin:6px 0 0;padding-left:20px}
.disagree article{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:16px 22px;margin:14px 0}.disagree ul{margin:6px 0 0;padding-left:22px}.disagree li{margin:4px 0}code{background:#1b2635;padding:1px 6px;border-radius:4px;font-size:.9em}
table{border-collapse:collapse;width:100%;font-size:17px;margin:12px 0}th,td{text-align:left;padding:8px 12px;border-bottom:1px solid var(--line)}th{color:var(--muted);text-transform:uppercase;font-size:13px;letter-spacing:1.2px}.cols{display:grid;grid-template-columns:1fr 1.6fr;gap:24px}tr.v-held td:last-child{color:var(--ok)}tr.v-failed td:last-child,tr.v-false-positive td:last-child{color:var(--bad)}tr.v-partial td:last-child{color:var(--warn)}
@media (max-width:900px){.tiles{grid-template-columns:repeat(2,1fr)}.cols{grid-template-columns:1fr}main{padding:20px}}
</style></head><body><main>
<h1>Station Kepler — cross-persona playtest report</h1>
<p class="sub">Run <code>${esc(m.run.runId)}</code> · seed ${esc(m.run.seed)} · ${esc(m.run.backend)} · ${esc(m.run.startedAt ?? '')} · ${m.personas.length} persona-driven Codex agents (gpt-6-astra)</p>
${sections.join('\n')}
</main></body></html>`;
}
