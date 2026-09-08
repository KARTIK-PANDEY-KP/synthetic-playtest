/**
 * Replay-verify findings against the game.
 *
 * For each member finding of a cluster: slice the reporter's input actions from step 0 to
 * finding.step (+3, so signals that fired just after the note are covered), convert to the
 * game's replay log `[{t, tool, args}]`, load
 *   <game-url>?seed=<seed>&replay=inline:<base64 json>
 * in Playwright, wait for `window.__replay.done`, then check that the same ground-truth
 * signal(s) recorded in the original session near the finding recur. "Near" is 5 steps
 * before to 3 after the note — the same window the scorer's telemetry key uses, because a
 * flaw fires first and the tester writes it up a few actions later. If the cluster was
 * already joined to a ledger flaw, that flaw's own signal is checked first.
 *
 * Contract we write against (game team may still be building it):
 *   window.__replay = { done: boolean, events: GameEvent[] }
 *
 * A member reproduces when EVERY primary signal recurs (the matched flaw's own signal when the
 * cluster carries a ledgerId, else every signal recorded near the note). A cluster is
 * verified when any member reproduces.
 * Outcomes: true = reproduced; false = replay ran, a primary signal did not recur;
 * null = could not verify (no signal to check, replay unsupported, timeout) — never false.
 */
import { INPUT_TOOLS } from './archive.mjs';
import { signalsNear, signalKey } from './attribution.mjs';
import { withDefaults } from './text.mjs';

export const VERIFY_DEFAULTS = { timeoutMs: 60_000, maxPerCluster: 3, stepBefore: 5, stepAfter: 3, supportTimeoutMs: 8_000 };

export function replayLog(persona, step, window = 3) {
  return persona.inputActions.filter((a) => a.step <= step + window).map((a) => ({ t: a.t, tool: a.tool, args: a.args ?? {} }));
}

export function replayUrl(gameUrl, seed, log) {
  const b64 = Buffer.from(JSON.stringify(log), 'utf8').toString('base64');
  const u = new URL(gameUrl);
  u.searchParams.set('seed', String(seed));
  u.searchParams.set('replay', `inline:${b64}`);
  return u.toString();
}

/** Run one replay in an existing browser context. Returns { status, events, note }. */
export async function runReplay(context, url, { timeoutMs, supportTimeoutMs }) {
  const page = await context.newPage();
  try {
    await page.goto(url, { waitUntil: 'load', timeout: timeoutMs });
    try {
      await page.waitForFunction(() => typeof window.__replay === 'object' && window.__replay !== null, null, { timeout: supportTimeoutMs });
    } catch {
      return { status: 'unsupported', events: [], note: 'game did not expose window.__replay — replay mode unsupported by this build' };
    }
    try {
      await page.waitForFunction(() => window.__replay && window.__replay.done === true, null, { timeout: timeoutMs });
    } catch {
      return { status: 'timeout', events: [], note: `replay did not finish within ${timeoutMs} ms` };
    }
    const events = await page.evaluate(() => JSON.parse(JSON.stringify(window.__replay.events ?? [])));
    return { status: 'done', events, note: null };
  } catch (e) {
    return { status: 'error', events: [], note: `replay failed: ${e.message.split('\n')[0]}` };
  } finally {
    await page.close().catch(() => {});
  }
}

export async function verifyRun(run, clusters, { gameUrl, log = () => {}, ...opts }) {
  const o = withDefaults(VERIFY_DEFAULTS, opts);
  const personasById = Object.fromEntries(run.personas.map((p) => [p.id, p]));
  const { chromium } = await import('playwright');
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const summary = { verified: 0, falsified: 0, unverifiable: 0, replays: 0, unsupported: false };
  try {
    for (const c of clusters) {
      const notes = []; let anyTrue = false, anyFalse = false, ranAny = false;
      const members = c.members.slice(0, o.maxPerCluster);
      if (summary.unsupported) {   // detected once; no point probing every finding against a build without replay
        c.verified = null; c.verificationNote = 'game did not expose window.__replay — replay mode unsupported by this build'; summary.unverifiable++; continue;
      }
      for (const m of members) {
        const p = personasById[m.persona]; if (!p) continue;
        const f = p.findings.find((x) => x.id === m.findingId) ?? { step: m.step };
        const near = signalsNear(p, f.step ?? 0, o.stepBefore, o.stepAfter);
        const own = c.ledgerId ? [`flaw_triggered:${c.ledgerId}`, `softlock_entered:${c.ledgerId}`].filter((k) => p.telemetry.some((e) => signalKey(e) === k && p.stepAt(e.t) <= (f.step ?? 0) + o.stepAfter)) : [];
        const expected = own.length ? own : near;   // what MUST recur
        if (!expected.length) { notes.push(`${m.persona}: no ground-truth signal within ${o.stepBefore} steps before / ${o.stepAfter} after the note — nothing to replay against`); continue; }
        const log_ = replayLog(p, f.step ?? 0, o.stepAfter);
        const url = replayUrl(gameUrl, run.meta.seed ?? 1, log_);
        log(`[verify] ${c.id} ${m.persona}#${m.findingId}: replaying ${log_.length} actions, expecting ${expected.join(', ')}\n`);
        const r = await runReplay(context, url, o); summary.replays++;
        if (r.status === 'unsupported') { summary.unsupported = true; notes.push(`${m.persona}: ${r.note}`); break; }
        if (r.status !== 'done') { notes.push(`${m.persona}: ${r.note}`); continue; }
        ranAny = true;
        const got = new Set(r.events.map(signalKey));
        const hit = expected.filter((s) => got.has(s)), miss = expected.filter((s) => !got.has(s));
        if (!miss.length) { anyTrue = true; notes.push(`${m.persona}: reproduced ${hit.join(', ')} after replaying ${log_.length} actions${own.length ? ' (the matched ledger flaw itself)' : ''}`); }
        else { anyFalse = true; notes.push(`${m.persona}: replayed ${log_.length} actions but ${miss.join(', ')} did not recur${hit.length ? ` (${hit.join(', ')} did)` : ''}`); }
      }
      c.verified = anyTrue ? true : (ranAny && anyFalse ? false : null);
      c.verificationNote = notes.join(' · ') || 'no members replayed';
      if (c.verified === true) summary.verified++; else if (c.verified === false) summary.falsified++; else summary.unverifiable++;
    }
  } finally {
    await browser.close();
  }
  return summary;
}
