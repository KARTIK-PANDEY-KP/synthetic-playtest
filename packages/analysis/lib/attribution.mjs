/**
 * Attribution: is a finding the game's fault or the agent's?
 *
 * Read ONLY from ground truth — `telemetry` SessionEvents (positions, idle, the absence
 * of progress events) plus the harness-recorded `action` log. Never from what the model
 * wrote about itself.
 *
 * A *stall* is ≥ STALL_STEPS consecutive input actions with no progress event
 * (room_entered / item_picked / item_used / puzzle_solved) between them, all within
 * RADIUS units of one another (so walking across a room is not a stall, hovering is).
 * Each stall carries the ground-truth signals (flaw_triggered / puzzle_failed …) that fired
 * while the tester was in it. Two personas "stalled at the same spot" when their windows
 * are in the same room within RADIUS and their signals are compatible: a window that
 * fired G1 does not count towards a finding whose signature is puzzle_failed:vent_lock,
 * even though the vent and the duct terminal are two metres apart.
 *
 * Rule (docs/INTERFACES.md): 3+ of 4 personas stalling at the same ground-truth spot ⇒
 * `game`; exactly 1 ⇒ `agent`; otherwise `unclear`. For N ≠ 4 the 3-of-4 is read as 75%.
 *
 * One refinement, also grounded in harness data: when exactly one persona stalled but
 * every persona who reached the same spot and did NOT stall used a tool there that the
 * staller never used anywhere (e.g. `listen`, which an `audio: off` persona does not
 * even have), the stall is explained by an enforced capability gap, not incompetence,
 * and the finding is attributed to the game with that evidence attached.
 */
import { INPUT_TOOLS, PROGRESS_EVENTS, SIGNAL_EVENTS } from './archive.mjs';
import { withDefaults } from './text.mjs';

export const DEFAULTS = { stallSteps: 6, radius: 2.0, signalWindow: 3 };
const CAPABILITY_TOOLS = new Set(['listen', 'crouch', 'use_item', 'open_inventory', 'type_text']);

const dist = (a, b) => Math.hypot((a?.x ?? 0) - (b?.x ?? 0), (a?.z ?? 0) - (b?.z ?? 0));
const centroid = (pts) => pts.length ? { x: pts.reduce((s, p) => s + p.x, 0) / pts.length, z: pts.reduce((s, p) => s + p.z, 0) / pts.length } : null;

/** Per-persona ground-truth digest: stall windows, rooms reached, tools used per room. */
export function analyzePersona(p, opts = {}) {
  const { stallSteps, radius } = withDefaults(DEFAULTS, opts);
  const tel = p.telemetry;
  const inputs = p.inputActions;

  // Annotate each input action with room + position at its start.
  const annotated = inputs.map((a) => ({ a, room: p.roomAt(a.t), pos: p.positionAt(a.t), t: a.t }));

  // Split into no-progress runs, then into spatial segments.
  const runs = []; let cur = [];
  let ti = 0;
  const progressTimes = tel.filter((e) => PROGRESS_EVENTS.has(e.type)).map((e) => e.t);
  for (let i = 0; i < annotated.length; i++) {
    const x = annotated[i];
    const next = annotated[i + 1];
    cur.push(x);
    // progress between this action and the next one ends the run
    const end = next ? next.t : Infinity;
    while (ti < progressTimes.length && progressTimes[ti] < x.t) ti++;
    const progressed = ti < progressTimes.length && progressTimes[ti] >= x.t && progressTimes[ti] < end;
    if (progressed) { runs.push(cur); cur = []; ti++; }
  }
  if (cur.length) runs.push(cur);

  const stalls = [];
  for (const run of runs) {
    let seg = [];
    const flush = () => {
      if (seg.length >= stallSteps) {
        const pts = seg.map((s) => s.pos).filter(Boolean);
        const c = centroid(pts) ?? { x: 0, z: 0 };
        const t0 = seg[0].t, t1 = seg[seg.length - 1].t;
        // ground-truth events that fired while stuck HERE: after the previous input action (or
        // session start, so the time-based tutorial flaw counts for the spawn stall) up to
        // shortly after the window's last action.
        const prevIdx = annotated.findIndex((x) => x === seg[0]) - 1;
        const prevBoundary = prevIdx >= 0 ? annotated[prevIdx].t : -1;
        const events = tel.filter((e) => e.t > prevBoundary && e.t <= t1 + 3000 && SIGNAL_EVENTS.has(e.type));
        stalls.push({
          room: seg[0].room, spot: { x: +c.x.toFixed(2), z: +c.z.toFixed(2) },
          steps: seg.length, fromStep: seg[0].a.step, toStep: seg[seg.length - 1].a.step, t0, t1,
          signals: [...new Set(events.map(signalKey))],
          idleMs: tel.filter((e) => e.type === 'idle' && e.t >= t0 && e.t <= t1 + 5000).reduce((m, e) => Math.max(m, e.ms), 0),
          tools: [...new Set(seg.map((s) => s.a.tool))],
        });
      }
      seg = [];
    };
    for (const x of run) {
      if (seg.length && (x.room !== seg[0].room || (x.pos && centroid(seg.map((s) => s.pos).filter(Boolean)) && dist(x.pos, centroid(seg.map((s) => s.pos).filter(Boolean))) > radius))) flush();
      seg.push(x);
    }
    flush();
  }

  // Tools used per room (harness-recorded actions, all tools incl. listen).
  const toolsByRoom = {};
  for (const a of p.actions) {
    const room = p.roomAt(a.t) ?? 'unknown';
    (toolsByRoom[room] ??= new Set()).add(a.tool);
  }
  const toolsEver = new Set(p.actions.map((a) => a.tool));
  const visited = (room, spot, r = radius) => tel.some((e) => e.type === 'position' && p.roomAt(e.t) === room && dist(e, spot) <= r);

  return { id: p.id, stalls, rooms: p.roomsReached(), lastRoom: p.lastRoom(), toolsByRoom, toolsEver, visited, enforcement: p.enforcement, name: p.name };
}

export const signalKey = (e) => e.type === 'flaw_triggered' || e.type === 'softlock_entered' ? `${e.type}:${e.flawId}` : e.type === 'puzzle_failed' ? `puzzle_failed:${e.puzzle}` : e.type;

/** Ground-truth signals within [step-before, step+after] of a finding in its reporter's session. */
export function signalsNear(p, step, before = DEFAULTS.signalWindow, after = before) {
  return [...new Set(p.telemetry.filter((e) => { if (!SIGNAL_EVENTS.has(e.type)) return false; const d = p.stepAt(e.t) - step; return d >= -before && d <= after; }).map(signalKey))];
}

export function gameThreshold(n, override) {
  if (override) return override;
  if (n === 4) return 3;
  return Math.max(2, Math.ceil(0.75 * n));
}

/**
 * Attribute one cluster.
 * @param cluster { room, members: [{persona, finding}] }
 * @param digests analyzePersona() per persona id
 * @param personasById loaded personas
 */
/** Each soft-lock event goes to the same persona's finding filed soonest after it, within 10 steps. */
export function claimObjectiveSignals(clusters, run) {
  const claims = new Map();
  for (const p of run.personas) {
    const notes = [];
    // A soft-lock corroborates a report of a BUG or something UNFAIR. A confusion or
    // boredom note filed nearby is a different complaint and must not inherit it.
    for (const c of clusters) for (const m of c.members)
      if (m.persona === p.id && ['bug', 'unfair'].includes(m.finding.category)) notes.push({ c, step: m.finding.step ?? 0 });
    for (const e of p.telemetry) {
      const k = signalKey(e); if (!k || !k.startsWith('softlock_entered:')) continue;
      const at = p.stepAt(e.t); let best = null;
      for (const n of notes) { const d = n.step - at; if (d >= 0 && d <= 10 && (!best || d < best.d)) best = { c: n.c, d }; }
      if (best) { if (!claims.has(best.c.id)) claims.set(best.c.id, new Set()); claims.get(best.c.id).add(k); }
    }
  }
  return claims;
}

export function attribute(cluster, digests, personasById, opts = {}) {
  const { radius, signalWindow } = withDefaults(DEFAULTS, opts);
  const N = Object.keys(digests).length;
  const threshold = gameThreshold(N, opts.gameThreshold);

  // Where was each reporter when they noted it? Prefer the stall window that contains the step.
  const spots = []; const signature = new Set();
  for (const m of cluster.members) {
    const p = personasById[m.persona]; if (!p) continue;
    const d = digests[m.persona];
    const step = m.finding.step ?? 0;
    const stall = d.stalls.find((s) => s.room === cluster.room && step >= s.fromStep - 1 && step <= s.toStep + 1);
    const pos = stall ? stall.spot : p.positionAt(p.timeAtStep(step));
    if (pos) spots.push({ x: pos.x, z: pos.z });
    // what fired just before the note (flaws fire, then the tester notices); one step of lag after
    for (const s of signalsNear(p, step, signalWindow, 1)) if (s.startsWith('flaw_triggered:') || s.startsWith('softlock_entered:') || s.startsWith('puzzle_failed:')) signature.add(s);
  }
  const spot = centroid(spots);
  // compatible = shares a signal, or the window fired nothing at all (stuck without tripping any ledger event)
  const matchesSignature = (stall) => !signature.size || !stall.signals.length || stall.signals.some((s) => signature.has(s));

  const stalled = [];
  for (const [id, d] of Object.entries(digests)) {
    const hit = d.stalls.find((s) => s.room === cluster.room && (!spot || dist(s.spot, spot) <= radius) && matchesSignature(s));
    if (hit) stalled.push({ persona: id, steps: hit.steps, idleMs: hit.idleMs, signals: hit.signals });
  }

  // Same-room tier. A room can have several instances of one affordance (the concourse
  // has four identical doors ~8 units apart): testers stall at different spots on the
  // same complaint. If enough of them stalled in the room with a compatible signature,
  // that is still the game — one fix would clear all of them. Position agreement stays
  // the stronger tier and is what the evidence reports when it holds.
  const stalledInRoom = [];
  for (const [id, d] of Object.entries(digests)) {
    const hit = d.stalls.find((s) => s.room === cluster.room && matchesSignature(s));
    if (hit) stalledInRoom.push({ persona: id, steps: hit.steps, idleMs: hit.idleMs, signals: hit.signals, spot: hit.spot });
  }
  const distinctSpots = new Set(stalledInRoom.map((s) => `${Math.round(s.spot.x)},${Math.round(s.spot.z)}`)).size;

  // Room tier only counts REPORTERS of this cluster who also stalled in the room — other
  // personas stuck nearby on something else are not evidence for this complaint.
  const reporterIds = new Set(cluster.members.map((m) => m.persona));
  const corroborated = stalledInRoom.filter((s) => reporterIds.has(s.persona));
  // Objective tier: a failure state the game itself recorded is ground truth regardless
  // of how many testers reached that point.
  // Only a soft-lock is unambiguously the game's fault. puzzle_failed fires when the TESTER
  // guesses wrong, and dying to a timer is a design choice the fairness flaws cover.
  // A soft-lock event is claimed by exactly ONE finding — the same persona's note filed
  // soonest after it (claimObjectiveSignals) — so a later, unrelated complaint in the same
  // room does not inherit it.
  const isObjective = (k) => k.startsWith('softlock_entered:');
  const objective = new Set([...signature].filter(isObjective));
  for (const k of opts.claims?.get(cluster.id) ?? []) objective.add(k);

  let attribution = 'unclear'; let tier = 'spot';
  if (stalled.length >= threshold) attribution = 'game';
  else if (objective.size) { attribution = 'game'; tier = 'objective'; }
  else if (reporterIds.size >= threshold && corroborated.length >= Math.ceil(reporterIds.size / 2)) { attribution = 'game'; tier = 'room'; }
  else if (stalled.length === 1 && reporterIds.size === 1) attribution = 'agent';   // one tester, one stall: theirs

  const evidence = {
    rule: tier === 'room'
      ? `${reporterIds.size} of ${N} personas reported this and ${corroborated.length} of them stalled in ${cluster.room}, at ${distinctSpots} distinct spots (game ⇔ ≥${threshold} reporters, half corroborated by a stall)`
      : tier === 'objective'
      ? `the game itself recorded a failure state here (${[...objective].join(', ')}) — objective, independent of tester count`
      : `${stalled.length} of ${N} personas stalled here (game ⇔ ≥${threshold}, agent ⇔ exactly 1)`,
    tier, objective: [...objective], corroborated: corroborated.map(({ spot, ...rest }) => rest),
    room: cluster.room, spot: spot ? { x: +spot.x.toFixed(2), z: +spot.z.toFixed(2) } : null,
    signature: [...signature], stalled, threshold,
    reached: Object.values(digests).filter((d) => d.rooms.includes(cluster.room)).map((d) => d.id),
  };

  // Capability-gap refinement for the sole-staller case.
  if (stalled.length === 1 && spot) {   // sole staller: look for an enforced capability gap, whatever tier decided
    const lone = digests[stalled[0].persona];
    const others = Object.values(digests).filter((d) => d.id !== lone.id && d.rooms.includes(cluster.room) && d.visited(cluster.room, spot, radius + 1));
    if (others.length >= 2) {
      let common = null;
      for (const d of others) {
        const used = new Set([...(d.toolsByRoom[cluster.room] ?? [])].filter((t) => CAPABILITY_TOOLS.has(t)));
        common = common ? new Set([...common].filter((t) => used.has(t))) : used;
      }
      const gap = [...(common ?? [])].filter((t) => !lone.toolsEver.has(t));
      if (gap.length) {
        const tool = gap.includes('listen') ? 'listen' : gap[0];
        const enf = lone.enforcement ?? {};
        const why = tool === 'listen' && enf.audio === 'off' ? `${lone.name} plays with audio off — the listen tool does not exist for this persona`
          : tool === 'crouch' && enf.genre_familiarity === 'none' ? `${lone.name} has no genre familiarity — crouch was never mentioned to them`
            : `${lone.name} never used ${tool} (persona enforcement: ${Object.entries(enf).map(([k, v]) => `${k}=${v}`).join(', ')})`;
        attribution = 'game';
        evidence.capabilityGap = { tool, staller: lone.id, comparedTo: others.map((d) => d.id), why };
        evidence.rule += `; overridden to game: every persona who passed this spot used \`${tool}\` here and ${lone.id} never did`;
      }
    }
  }
  return { attribution, evidence };
}
