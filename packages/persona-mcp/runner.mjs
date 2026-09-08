#!/usr/bin/env node
/**
 * RUNNER CLI — plays one persona to completion. See docs/INTERFACES.md.
 *
 *   node packages/persona-mcp/runner.mjs --persona personas/maya.json --game-url http://127.0.0.1:5273/ \
 *        --seed 7 --out runs/<runId>/maya [--max-steps N] [--codex-home DIR] [--viewer-port N] [--timeout-min N]
 *
 * Owns the browser (GameSession), the session log, the viewer, and the codex
 * process. Codex spawns server.mjs as MCP server `game`; that shim forwards every
 * tool call back here over loopback. SessionEvents stream to stdout as JSON lines
 * and to <out>/session.jsonl. Exit 0 iff <out>/report.json parses as a PlaytestReport.
 */
import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { GameSession, startControl } from './session.mjs';
import { startViewer } from './viewer.mjs';
import { buildBrief } from './brief.mjs';
import { costUsd } from './cost.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVER = join(HERE, 'server.mjs');
const SCHEMA = resolve(HERE, '../protocol/report.schema.json');
const MODEL = 'gpt-6-astra';

// ── args ─────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const opt = (name, dflt) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : dflt; };
const personaPath = opt('persona');
const gameUrl = opt('game-url');
const seed = Number(opt('seed', '1'));
const out = opt('out');
const maxSteps = opt('max-steps');
const codexHomeOpt = opt('codex-home');
const viewerPort = Number(opt('viewer-port', '8080'));
const timeoutMin = Number(opt('timeout-min', '30'));
if (!personaPath || !gameUrl || !out) {
  console.error('usage: runner.mjs --persona <json> --game-url <url> --out <dir> [--seed N] [--max-steps N] [--codex-home DIR] [--viewer-port N] [--timeout-min N]');
  process.exit(2);
}

// ── run dir + persona actually used ──────────────────────────────────────────
const runDir = resolve(out);
mkdirSync(join(runDir, 'frames'), { recursive: true });
const persona = JSON.parse(readFileSync(personaPath, 'utf8'));
if (maxSteps) persona.enforcement.step_budget = Number(maxSteps);
writeFileSync(join(runDir, 'persona.json'), JSON.stringify(persona, null, 2));
const reportPath = join(runDir, 'report.json');
const costPath = join(runDir, 'cost.json');
rmSync(reportPath, { force: true });
rmSync(join(runDir, 'session.jsonl'), { force: true });

// ── event plumbing: everything goes to stdout AND session.jsonl ───────────────
// The session log names every flaw the tester hits. While codex is alive it lives at
// an unguessable temp path outside the agent's cwd, and is moved into the run dir
// only after codex exits. The live feed (stdout + /stream) is unaffected.
const privateDir = mkdtempSync(join(tmpdir(), 'sp-session-'));
const privateSessionPath = join(privateDir, 'session.jsonl');
const publicSessionPath = join(runDir, 'session.jsonl');
const publishSession = () => { try { copyFileSync(privateSessionPath, publicSessionPath); } catch { /* nothing logged yet */ } };
const session = await GameSession.create({ persona, gameUrl, seed, runDir, sessionPath: privateSessionPath });
const out$ = (e) => process.stdout.write(JSON.stringify(e) + '\n');
session.subscribe(out$);
const emit = (e) => session.emit(e);
const status = (s, detail) => emit({ kind: 'status', status: s, ...(detail ? { detail } : {}) });
status('starting', `${persona.id} · seed ${seed} · budget ${persona.enforcement.step_budget}`);

const usage = { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 };
const writeCost = () => writeFileSync(costPath, JSON.stringify({ steps: session.steps, ...usage, usd: +costUsd(usage).toFixed(4) }, null, 2));
writeCost();

const control = await startControl(session);
let viewer = null;
if (viewerPort > 0) {
  try {
    viewer = await startViewer({ port: viewerPort, session, events: { history: () => session.history, subscribe: (cb) => session.subscribe(cb) } });
    console.error(`[runner] viewer: http://127.0.0.1:${viewer.port}/  (/live MJPEG, /stream SSE)`);
  } catch (err) {
    console.error(`[runner] viewer disabled: ${err.message}`);
  }
}

// ── codex home: config.toml + auth ───────────────────────────────────────────
// Not under tmpdir(): codex refuses to create its helper binaries there ("Refusing to
// create helper binaries under temporary dir") and warns on every run.
const codexHomeBase = join(homedir(), '.cache', 'synthetic-playtest');
mkdirSync(codexHomeBase, { recursive: true });
const codexHome = codexHomeOpt ? resolve(codexHomeOpt) : mkdtempSync(join(codexHomeBase, `codex-${persona.id}-`));
mkdirSync(codexHome, { recursive: true });
const toml = (s) => JSON.stringify(s); // TOML basic strings share JSON's escaping for paths (spaces, quotes, backslashes)
writeFileSync(join(codexHome, 'config.toml'), `model = ${toml(MODEL)}
model_reasoning_effort = ${toml(persona.enforcement.reasoning_effort ?? 'medium')}

[mcp_servers.game]
command = "node"
args = [${toml(SERVER)}]
startup_timeout_sec = 30
tool_timeout_sec = 120
# Pre-approve every game tool. Without this each MCP call goes through the
# --approve-for-me auto-reviewer, a second model session that cost ~38% of the
# tokens in the first measured run. (Valid: auto | prompt | writes | approve.)
default_tools_approval_mode = "approve"

[mcp_servers.game.env]
PERSONA_CONFIG = ${toml(join(runDir, 'persona.json'))}
GAME_URL = ${toml(gameUrl)}
SEED = ${toml(String(seed))}
RUN_DIR = ${toml(runDir)}
RUNNER_CONTROL_URL = ${toml(control.url)}
`);
let copiedAuth = null;
const childEnv = { ...process.env, CODEX_HOME: codexHome };
if (!process.env.CODEX_API_KEY) {
  const src = join(homedir(), '.codex', 'auth.json');
  if (!existsSync(src)) { status('failed', 'no CODEX_API_KEY and no ~/.codex/auth.json'); await shutdown(); process.exit(1); }
  copiedAuth = join(codexHome, 'auth.json');
  if (!existsSync(copiedAuth)) copyFileSync(src, copiedAuth);
}

// ── output schema: OpenAI strict mode wants every property required ───────────
// The shared schema marks room/frame/abandonedReason optional, which the API
// rejects ("'required' ... must include every key"). Derive a strict twin:
// optional → required + nullable. Nulls are stripped from the saved report, so
// what lands on disk still matches packages/protocol/report.schema.json.
const strictSchema = strictify(JSON.parse(readFileSync(SCHEMA, 'utf8')));
const strictSchemaPath = join(codexHome, 'report.strict.schema.json');
writeFileSync(strictSchemaPath, JSON.stringify(strictSchema, null, 2));

// ── the brief (byte-stable per persona; saved for the record) ────────────────
const brief = buildBrief(persona);
writeFileSync(join(runDir, 'brief.md'), brief);

// ── spawn codex ──────────────────────────────────────────────────────────────
// The brief travels on stdin ('-'): as an argv prompt codex still reads stdin and
// appends whatever it finds, which would perturb the byte-stable prefix.
// Codex's own sandbox is Seatbelt on macOS and bubblewrap on Linux. bwrap cannot create
// namespaces inside a container (Modal, Docker): view_image fails with "fs sandbox helper
// failed … bwrap: loopback: Failed RTM_NEWADDR" and the agent plays blind. When the runner
// is told it is already externally sandboxed, codex's sandbox is bypassed — the documented
// use of that flag. Never set this on a developer's machine.
const externallySandboxed = process.env.CODEX_EXTERNALLY_SANDBOXED === '1';
const sandboxArgs = externallySandboxed ? ['--dangerously-bypass-approvals-and-sandbox'] : ['--approve-for-me'];
if (externallySandboxed) console.error('[runner] CODEX_EXTERNALLY_SANDBOXED=1 — bypassing codex\'s own sandbox (container has no bwrap)');
const args = ['exec', '--json', '--skip-git-repo-check', ...sandboxArgs, '-C', join(runDir, 'frames'), '-m', MODEL,
  '--output-schema', strictSchemaPath, '-o', reportPath, '-'];
console.error(`[runner] codex ${args.join(' ')}  < brief (${brief.length} chars)`);
const codex = spawn('codex', args, { env: childEnv, stdio: ['pipe', 'pipe', 'pipe'] });
codex.stdin.end(brief);
let playing = false;
const LEAK = /session\.jsonl|persona\.json|cost\.json|report\.json|brief\.md|codex-home|__telemetry/i;
let leakWarnings = 0;

createInterface({ input: codex.stdout }).on('line', (line) => {
  let ev; try { ev = JSON.parse(line); } catch { return console.error(`[codex] ${line}`); }
  emit({ kind: 'codex', event: ev });
  const type = String(ev.type ?? '');
  if (!playing && (type === 'thread.started' || type.startsWith('item.'))) { playing = true; status('playing'); }
  const u = ev.usage ?? ev.item?.usage;
  if (type === 'turn.completed' && u) {
    const input = u.input_tokens ?? 0, cached = u.cached_input_tokens ?? 0, output = u.output_tokens ?? 0;
    usage.inputTokens += input; usage.cachedInputTokens += cached; usage.outputTokens += output;
    emit({ kind: 'usage', input, cached, output });
    writeCost();
  }
  if (type === 'item.completed' || type === 'item.started') {
    const item = ev.item ?? {};
    const probe = `${item.command ?? ''} ${item.input ?? ''} ${item.path ?? ''}`;
    if ((item.type === 'command_execution' || item.type === 'exec') && LEAK.test(probe)) {
      leakWarnings++;
      console.error(`[runner] WARNING: agent touched a harness file: ${probe.slice(0, 200)}`);
    }
  }
});
createInterface({ input: codex.stderr }).on('line', (line) => console.error(`[codex] ${line}`));

// Flip to "reporting" the moment the persona quits or is forced to.
session.subscribe((e) => { if (e.kind === 'gate' && (e.gate === 'abandon' || /refused|exhausted|spent|ceiling/.test(e.detail ?? ''))) status('reporting', e.detail); });

const timer = setTimeout(() => { console.error(`[runner] wall clock ${timeoutMin} min exceeded; stopping codex`); codex.kill('SIGTERM'); }, timeoutMin * 60_000);
const onSignal = (sig) => { console.error(`[runner] ${sig}; stopping`); codex.kill('SIGTERM'); };
  publishSession();
process.on('SIGINT', () => onSignal('SIGINT'));
process.on('SIGTERM', () => onSignal('SIGTERM'));

const exitCode = await new Promise((r) => codex.on('close', (code) => r(code)));
clearTimeout(timer);
publishSession();

// ── verdict ──────────────────────────────────────────────────────────────────
const report = readReport();
if (report) {
  mergeNotedFindings(report);
  writeFileSync(reportPath, JSON.stringify(report, null, 2));
  writeCost();
  status('done', `${report.findings.length} findings · ${session.steps} steps · $${costUsd(usage).toFixed(2)}${leakWarnings ? ` · ${leakWarnings} harness-file warnings` : ''}`);
  publishSession();   // the final status line lands after the first publish
  await shutdown();
  process.exit(0);
} else {
  writeCost();
  status('failed', `codex exited ${exitCode}; no valid report.json`);
  publishSession();   // the final status line lands after the first publish
  await shutdown();
  process.exit(1);
}

function readReport() {
  try {
    const r = stripNulls(JSON.parse(readFileSync(reportPath, 'utf8')));
    const ok = r && typeof r.persona === 'string' && typeof r.summary === 'string' && typeof r.completed === 'boolean'
      && Array.isArray(r.findings) && r.experience && ['confused', 'bored', 'unfair', 'enjoyed'].every((k) => Array.isArray(r.experience[k]))
      && Number.isInteger(r.wouldRecommend) && r.wouldRecommend >= 1 && r.wouldRecommend <= 5
      && r.findings.every((f) => f && typeof f.title === 'string' && typeof f.severity === 'string' && typeof f.category === 'string');
    return ok ? r : null;
  } catch { return null; }
}

/** Findings noted mid-play ARE the persona's findings; if the final report forgot one, add it. */
function mergeNotedFindings(report) {
  const key = (f) => f.title.trim().toLowerCase();
  const noted = new Map(session.findings.map((f) => [key(f), f]));
  for (const f of session.findings) if (!report.findings.some((r) => key(r) === key(f))) report.findings.push(f);
  for (const f of report.findings) {
    // The runner's step counter and last-frame path are authoritative. The agent's own
    // `step` counts every tool call and its `frame` is a guess; the verifier slices the
    // action log by OUR step, so the two must agree.
    const n = noted.get(key(f));
    if (n) { if (Number.isInteger(n.step)) f.step = n.step; if (n.frame) f.frame = n.frame; }
    if (!Array.isArray(f.reproSteps)) f.reproSteps = [];
    if (!Number.isInteger(f.step)) f.step = session.steps;
    if (!f.id) f.id = `${persona.id}-f${report.findings.indexOf(f) + 1}`;
  }
}

/** Every object property required; formerly-optional ones accept null. Recursive. */
function strictify(node) {
  if (Array.isArray(node)) return node.map(strictify);
  if (!node || typeof node !== 'object') return node;
  const out = { ...node };
  if (out.type === 'object' && out.properties) {
    const required = new Set(out.required ?? []);
    out.properties = Object.fromEntries(Object.entries(out.properties).map(([k, v]) => {
      const sv = strictify(v);
      if (required.has(k)) return [k, sv];
      const types = Array.isArray(sv.type) ? sv.type : [sv.type];
      return [k, { ...sv, type: types.includes('null') ? types : [...types, 'null'] }];
    }));
    out.required = Object.keys(out.properties);
    out.additionalProperties = false;
  }
  if (out.items) out.items = strictify(out.items);
  return out;
}

function stripNulls(v) {
  if (Array.isArray(v)) return v.map(stripNulls);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).filter(([, x]) => x !== null).map(([k, x]) => [k, stripNulls(x)]));
  return v;
}

async function shutdown() {
  try { if (copiedAuth) rmSync(copiedAuth, { force: true }); } catch { /* best effort */ }
  try { await viewer?.close(); } catch { /* */ }
  try { control.server.close(); } catch { /* */ }
  try { await session.close(); } catch { /* */ }
}
