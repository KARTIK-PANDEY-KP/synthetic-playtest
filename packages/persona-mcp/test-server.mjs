/**
 * Drives server.mjs over stdio JSON-RPC exactly the way Codex does, in both modes
 * (shim → runner-owned session, and standalone), and checks the things that make a
 * persona real: the audio tool is absent for audio:off, screenshots are paths not
 * images, gates force an abandon, and nothing the agent can read mentions the
 * answer key. Also checks the brief is byte-stable and convention-free for `none`.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serveGame } from './serve.mjs';
import { GameSession, startControl } from './session.mjs';
import { toolDefinitions } from './tools.mjs';
import { buildBrief } from './brief.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVER = join(HERE, 'server.mjs');
const persona = (id) => JSON.parse(readFileSync(join(HERE, 'personas', `${id}.json`), 'utf8'));
const FORBIDDEN = /__telemetry|flaw|ledger|decoy/i;
const CONVENTIONS = /\bWASD\b|W\/A\/S\/D|\bCtrl\b|press(es)? E\b|\(E\)|\bkey E\b/i;

const results = [];
const check = (name, pass, detail = '') => { results.push({ name, pass }); console.log(`${pass ? ' ok ' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`); };

/** Minimal newline-delimited JSON-RPC client over a child's stdio. */
function rpcClient(env) {
  const child = spawn(process.execPath, [SERVER], { env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
  const pending = new Map();
  let buf = '';
  child.stdout.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1);
      if (!line.trim()) continue;
      try { const m = JSON.parse(line); if (m.id != null && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } } catch { /* ignore */ }
    }
  });
  child.stderr.on('data', (d) => process.stderr.write(`[server.mjs] ${d}`));
  let id = 0;
  const request = (method, params = {}) => new Promise((resolve, reject) => {
    const myId = ++id;
    pending.set(myId, resolve);
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: myId, method, params }) + '\n');
    setTimeout(() => { if (pending.has(myId)) { pending.delete(myId); reject(new Error(`timeout: ${method}`)); } }, 30_000);
  });
  const notify = (method, params = {}) => child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
  return {
    child, request, notify,
    async init() {
      const r = await request('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test-server', version: '0' } });
      notify('notifications/initialized');
      return r;
    },
    call: (name, args = {}) => request('tools/call', { name, arguments: args }),
    list: () => request('tools/list'),
    close: () => new Promise((r) => { child.on('close', r); child.stdin.end(); setTimeout(() => child.kill(), 2000); }),
  };
}

const text = (callResult) => (callResult.result?.content ?? []).map((c) => c.text ?? '').join('\n');
const agentVisible = []; // everything the model could read, for the final grep

const { server: gameServer, url } = await serveGame();

// ── 1. briefs ──────────────────────────────────────────────────────────────────
for (const id of ['maya', 'robert', 'dana', 'sam', 'priya']) {
  const p = persona(id);
  const a = buildBrief(p), b = buildBrief(JSON.parse(JSON.stringify(p)));
  check(`brief(${id}) is byte-stable`, a === b);
  check(`brief(${id}) never mentions the answer key`, !FORBIDDEN.test(a));
  agentVisible.push(a);
}
check('brief(robert, familiarity none) has no control conventions', !CONVENTIONS.test(buildBrief(persona('robert'))));
check('brief(maya, familiarity high) spells out the conventions', /W\/A\/S\/D/.test(buildBrief(persona('maya'))));
check('brief(dana, familiarity medium) only hints', /usually have movement keys/.test(buildBrief(persona('dana'))) && !CONVENTIONS.test(buildBrief(persona('dana'))));
check('brief(dana, audio off) never mentions listen', !/listen/.test(buildBrief(persona('dana'))));

// ── 2. tool descriptions ───────────────────────────────────────────────────────
const descr = (p) => toolDefinitions(p).map((t) => `${t.name}: ${t.description} ${JSON.stringify(t.inputSchema)}`).join('\n');
check('tools(robert) descriptions have no control conventions', !CONVENTIONS.test(descr(persona('robert'))), 'none → nothing about keys');
check('tools(maya) descriptions do mention keys', CONVENTIONS.test(descr(persona('maya'))));
check('tools(dana) has no listen tool', !toolDefinitions(persona('dana')).some((t) => t.name === 'listen'));
check('tools(maya) has a listen tool', toolDefinitions(persona('maya')).some((t) => t.name === 'listen'));
for (const id of ['maya', 'robert', 'dana']) agentVisible.push(descr(persona(id)));

// ── 3. shim mode: runner-owned session, server.mjs forwards ────────────────────
{
  const runDir = mkdtempSync(join(tmpdir(), 'sp-test-shim-'));
  const session = await GameSession.create({ persona: persona('maya'), gameUrl: url, seed: 7, runDir });
  const control = await startControl(session);
  const c = rpcClient({ PERSONA_CONFIG: join(HERE, 'personas', 'maya.json'), RUNNER_CONTROL_URL: control.url, RUN_DIR: runDir });
  const init = await c.init();
  check('shim: initialize answers', init.result?.serverInfo?.name === 'game');
  const list = await c.list();
  const names = (list.result?.tools ?? []).map((t) => t.name);
  check('shim: tools/list has the treaty tools', ['screenshot', 'move', 'look', 'crouch', 'interact', 'use_item', 'open_inventory', 'type_text', 'note_finding', 'abandon'].every((n) => names.includes(n)), names.join(','));
  check('shim: maya (audio on) gets listen', names.includes('listen'));

  const shot = await c.call('screenshot');
  const shotText = text(shot);
  const m = shotText.match(/Screenshot saved to: (.+)$/m);
  check('shim: screenshot returns TEXT with a path, no image block', !!m && (shot.result.content ?? []).every((b) => b.type === 'text'));
  check('shim: the PNG exists on disk', !!m && existsSync(m[1]), m?.[1]);
  check('shim: the frame lives under RUN_DIR/frames', !!m && m[1].startsWith(join(runDir, 'frames')));
  agentVisible.push(shotText);

  const mv = await c.call('move', { direction: 'forward', ms: 800 });
  agentVisible.push(text(mv));
  check('shim: move executes', /Walked forward/.test(text(mv)), text(mv).split('\n')[0]);
  const lines = readFileSync(join(runDir, 'session.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const actions = lines.filter((l) => l.kind === 'action');
  check('shim: session.jsonl has action lines for screenshot and move', actions.some((a) => a.tool === 'screenshot' && a.frame) && actions.some((a) => a.tool === 'move'), `${actions.length} actions`);
  check('shim: telemetry events are logged as kind:telemetry', lines.some((l) => l.kind === 'telemetry'));
  const listen = await c.call('listen');
  agentVisible.push(text(listen));
  check('shim: listen works for maya', !listen.result?.isError, text(listen).split('\n')[0]);

  // Patience gate: fake a genuine stall, take steps, expect nudges then a refusal.
  session.driver.stallSteps = 999;
  const nudges = [];
  for (let i = 0; i < 4; i++) nudges.push(text(await c.call('move', { direction: 'left', ms: 100 })));
  agentVisible.push(...nudges);
  check('gate: first nudged step is annoyed', /getting annoyed/.test(nudges[0]));
  check('gate: escalates', /irritated/.test(nudges[1]) && /last of your patience/.test(nudges[2]));
  check('gate: then every action is refused until abandon()', /had enough/.test(nudges[3]) && /abandon\(reason\)/.test(nudges[3]) && !/Walked/.test(nudges[3]));
  const gates = readFileSync(join(runDir, 'session.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)).filter((l) => l.kind === 'gate');
  check('gate: kind:gate events logged', gates.length >= 4 && gates.every((g) => g.gate === 'patience'), `${gates.length} gate events`);

  const nf = await c.call('note_finding', { severity: 'medium', category: 'confusion', title: 'test finding', description: 'd', reproSteps: ['a'] });
  agentVisible.push(text(nf));
  check('note_finding: accepted and logged', /Noted as maya-f1/.test(text(nf)) && session.findings[0]?.frame?.startsWith('frames/'), JSON.stringify(session.findings[0]));
  const ab = await c.call('abandon', { reason: 'test' });
  agentVisible.push(text(ab));
  const after = await c.call('move', { direction: 'forward' });
  agentVisible.push(text(after));
  check('abandon: subsequent actions tell the persona to write the report', /write your final report/i.test(text(after)));

  await c.close();
  control.server.close();
  await session.close();
}

// ── 4. standalone mode + audio gate ────────────────────────────────────────────
{
  const runDir = mkdtempSync(join(tmpdir(), 'sp-test-standalone-'));
  const c = rpcClient({ PERSONA_CONFIG: join(HERE, 'personas', 'dana.json'), GAME_URL: url, SEED: '7', RUN_DIR: runDir });
  await c.init();
  const names = (await c.list()).result.tools.map((t) => t.name);
  check('standalone: dana (audio off) has NO listen tool', !names.includes('listen'), names.join(','));
  const denied = await c.call('listen');
  agentVisible.push(text(denied));
  check('standalone: calling listen anyway is an error', denied.result?.isError === true, text(denied));
  const shot = await c.call('screenshot');
  const m = text(shot).match(/Screenshot saved to: (.+)$/m);
  agentVisible.push(text(shot));
  check('standalone: screenshot PNG exists', !!m && existsSync(m[1]));
  check('standalone: session.jsonl written by the server process', existsSync(join(runDir, 'session.jsonl')));
  await c.close();
}

// ── 5. budget gate is a hard cap ───────────────────────────────────────────────
{
  const runDir = mkdtempSync(join(tmpdir(), 'sp-test-budget-'));
  const p = persona('sam'); p.enforcement.step_budget = 3;
  const s = await GameSession.create({ persona: p, gameUrl: url, seed: 7, runDir });
  const r1 = await s.call('move', { direction: 'forward', ms: 100 });
  const r2 = await s.call('move', { direction: 'forward', ms: 100 });
  const r3 = await s.call('move', { direction: 'forward', ms: 100 });
  const r4 = await s.call('move', { direction: 'forward', ms: 100 });
  agentVisible.push(r1.text, r2.text, r3.text, r4.text);
  check('budget: nudges as the budget runs out', /nearly out of time/.test(r1.text) && /nearly out of time/.test(r2.text));
  check('budget: the last step is carried out, then actions are refused', /Walked/.test(r3.text) && /out of time/.test(r4.text) && !/Walked/.test(r4.text));
  check('budget: steps never exceed the budget', s.steps === 3, `steps=${s.steps}`);
  await s.close();
}

// ── 6. the answer key never reaches the agent ──────────────────────────────────
const leak = agentVisible.find((t) => FORBIDDEN.test(t));
check('no agent-visible text mentions __telemetry / flaw / ledger / decoy', !leak, leak ? leak.slice(0, 120) : `${agentVisible.length} texts checked`);

gameServer.close();
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
