// Mock orchestrator — implements every route in docs/INTERFACES.md ("ORCHESTRATOR — HTTP/WS API")
// with realistic fake data so the dashboard can be built and demoed without the real backend.
//
//   node mock/server.mjs            (port 4000; MOCK_PORT / MOCK_SPEED to override)
//
// Personas progress on timers (queued → starting → playing → reporting → done), staggered so
// reports land at different times. /live is a real MJPEG stream rendered with sharp.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import { liveJpeg, agentPng } from "./frames.mjs";
import { ROOMS, ROOM_CUTS, SCRIPTS, CLUSTERED, SCORE, REPORT_MD, pickAnswer } from "./story.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.MOCK_PORT ?? 4000);
const SPEED = Number(process.env.MOCK_SPEED ?? 1);      // >1 = faster
const ms = (n) => Math.max(20, Math.round(n / SPEED));
const PERSONA_DIR = path.resolve(HERE, "../../../packages/persona-mcp/personas");
const LOCAL_PERSONAS = path.join(HERE, ".personas.json");
const GAME_URL = "http://127.0.0.1:5273/";
const TPM_LIMIT = 500_000;

// ── Persona registry ────────────────────────────────────────────────────────
const personas = new Map();
for (const f of fs.readdirSync(PERSONA_DIR).filter((f) => f.endsWith(".json")).sort()) {
  const p = JSON.parse(fs.readFileSync(path.join(PERSONA_DIR, f), "utf8"));
  personas.set(p.id, p);
}
if (fs.existsSync(LOCAL_PERSONAS)) {
  for (const p of JSON.parse(fs.readFileSync(LOCAL_PERSONAS, "utf8"))) personas.set(p.id, p);
}
const saveLocalPersonas = () => {
  const seeds = new Set(fs.readdirSync(PERSONA_DIR).map((f) => f.replace(/\.json$/, "")));
  fs.writeFileSync(LOCAL_PERSONAS, JSON.stringify([...personas.values()].filter((p) => !seeds.has(p.id)), null, 2));
};

// A generic script for personas created in the UI (no bespoke story).
function scriptFor(config) {
  if (SCRIPTS[config.id]) return SCRIPTS[config.id];
  const base = SCRIPTS[config.enforcement?.reading === "skim" ? "maya" : config.enforcement?.reading === "thorough" ? "priya" : "dana"];
  const budget = Math.min(config.enforcement?.step_budget ?? 60, 60);
  return {
    ...base,
    totalSteps: Math.max(16, Math.round(budget * 0.45)),
    completed: config.enforcement?.audio !== "off",
    abandonedReason: config.enforcement?.audio === "off" ? base.abandonedReason : undefined,
    findings: base.findings.slice(0, 2).map((f) => ({ ...f, id: `${config.id}-${f.id.split("-")[1]}` })),
    report: { ...base.report, summary: `(${config.name}) ${base.report.summary}` },
  };
}

// ── Runs ────────────────────────────────────────────────────────────────────
const runs = new Map();
const wsClients = new Set();
const broadcast = (ev) => {
  const s = JSON.stringify(ev);
  for (const c of wsClients) if (c.readyState === 1) c.send(s);
};

const rand = (a, b) => a + Math.random() * (b - a);
const roomAt = (k, N) => ROOMS[ROOM_CUTS.findIndex((c) => k / N < c)] ?? ROOMS[ROOMS.length - 1];
const TOOL_CYCLE = ["screenshot", "move", "look", "screenshot", "interact", "screenshot", "move", "use_item", "screenshot", "look", "open_inventory", "screenshot"];

function newRun({ personas: ids, seed, backend }) {
  const runId = `run_${Date.now().toString(36)}${Math.floor(Math.random() * 46656).toString(36).padStart(3, "0")}`;
  const counts = {};
  const states = new Map();
  for (const pid of ids) {
    const cfg = personas.get(pid);
    if (!cfg) throw Object.assign(new Error(`unknown persona ${pid}`), { status: 400 });
    counts[pid] = (counts[pid] ?? 0) + 1;
    const id = counts[pid] === 1 ? pid : `${pid}-${counts[pid]}`;
    states.set(id, {
      id, personaId: pid, config: cfg, script: scriptFor(cfg), idx: states.size,
      status: "queued", steps: 0, room: ROOMS[0],
      cost: { steps: 0, inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, usd: 0 },
      lastReasoning: undefined, session: [], findings: [], report: undefined,
      sse: new Set(), mjpeg: new Set(), timer: null, lastFrame: null,
    });
  }
  const run = {
    meta: { runId, startedAt: new Date().toISOString(), gameUrl: GAME_URL, seed: seed ?? 7, backend: backend ?? "local", personas: [...states.keys()], status: "running" },
    states, t0: Date.now(), governor: null,
  };
  runs.set(runId, run);
  return run;
}

function pushEvent(run, st, ev, { t } = {}) {
  const e = { t: t ?? Date.now() - run.t0, ...ev };
  st.session.push(e);
  const s = `data: ${JSON.stringify(e)}\n\n`;
  for (const res of st.sse) res.write(s);
  return e;
}

function setStatus(run, st, status, detail, opts) {
  st.status = status;
  pushEvent(run, st, { kind: "status", status, detail }, opts);
  broadcast({ type: "persona.status", runId: run.meta.runId, persona: st.id, status });
}

/** One step of a persona's playthrough: codex JSONL, action, telemetry, usage, maybe a finding. */
function doStep(run, st, opts = {}) {
  const N = st.script.totalSteps;
  const k = ++st.steps;
  const room = roomAt(k, N);
  const tool = k === 1 ? "screenshot" : TOOL_CYCLE[k % TOOL_CYCLE.length];
  const callId = `call_${st.id}_${k}`;
  const frame = tool === "screenshot" ? `frames/${String(k).padStart(5, "0")}.png` : undefined;
  const args = tool === "move" ? { direction: ["forward", "left", "right", "back"][k % 4], ms: 600 }
    : tool === "look" ? { direction: ["left", "right", "up"][k % 3], ms: 300 }
    : tool === "use_item" ? { name: room === "Power" ? "fuse" : room === "Greenhouse" ? "watering can" : "keycard" }
    : {};

  if (room !== st.room) {
    st.room = room;
    pushEvent(run, st, { kind: "telemetry", event: { t: 0, type: "room_entered", room } }, opts);
  }
  pushEvent(run, st, { kind: "codex", event: { type: "item.started", item: { id: callId, type: "mcp_tool_call", server: "game", tool, arguments: args, status: "in_progress" } } }, opts);
  const result = tool === "screenshot" ? `/agent/frames/${String(k).padStart(5, "0")}.png` : tool === "listen" ? "(no cues since last call)" : "ok";
  pushEvent(run, st, { kind: "action", step: k, tool, args, result, frame }, opts);
  pushEvent(run, st, { kind: "codex", event: { type: "item.completed", item: { id: callId, type: "mcp_tool_call", server: "game", tool, arguments: args, result: { content: [{ type: "text", text: result }] }, status: "completed" } } }, opts);
  pushEvent(run, st, { kind: "telemetry", event: { t: 0, type: "position", x: +(rand(-3, 3) + k * 0.4).toFixed(2), y: 1.7, z: +(-k * 0.9).toFixed(2), yaw: +rand(-1, 1).toFixed(2) } }, opts);

  // reasoning + one agent_message line for the pane
  const lines = st.script.lines[room] ?? [];
  const line = lines.length ? lines[Math.floor(((k / N - (ROOM_CUTS[ROOMS.indexOf(room) - 1] ?? 0)) / 0.2) * lines.length) % lines.length] : `Looking around the ${room.toLowerCase()}.`;
  pushEvent(run, st, { kind: "codex", event: { type: "item.completed", item: { id: `rs_${st.id}_${k}`, type: "reasoning", text: `**Step ${k}** — ${tool} in ${room}. ${line}` } } }, opts);
  if (k % 2 === 1 || k === N) {
    pushEvent(run, st, { kind: "codex", event: { type: "item.completed", item: { id: `msg_${st.id}_${k}`, type: "agent_message", text: line } } }, opts);
    st.lastReasoning = line;
  }

  // gates
  if (st.personaId === "robert" && k === Math.round(N * 0.3)) {
    pushEvent(run, st, { kind: "gate", gate: "patience", detail: "10 consecutive no-progress steps at MAINT. VENT — frustration escalated in tool results" }, opts);
  }

  // scripted findings
  for (const f of st.script.findings) {
    if (Math.max(1, Math.round(f.at * N)) === k) {
      const finding = { id: f.id, severity: f.severity, category: f.category, title: f.title, description: f.description, room: f.room, reproSteps: f.reproSteps, frame: `frames/${String(k).padStart(5, "0")}.png`, step: k };
      st.findings.push(finding);
      pushEvent(run, st, { kind: "finding", finding }, opts);
      broadcast({ type: "persona.finding", runId: run.meta.runId, persona: st.id, finding });
    }
  }

  // usage + cost (gpt-6-astra pricing: 10 / 1 / 50 per M)
  const input = Math.round(rand(58_000, 70_000)), cached = Math.round(input * rand(0.88, 0.94)), output = Math.round(rand(90, 260));
  pushEvent(run, st, { kind: "usage", input, cached, output }, opts);
  pushEvent(run, st, { kind: "codex", event: { type: "turn.completed", usage: { input_tokens: input, cached_input_tokens: cached, output_tokens: output } } }, opts);
  st.cost.steps = k; st.cost.inputTokens += input; st.cost.cachedInputTokens += cached; st.cost.outputTokens += output;
  st.cost.usd = ((st.cost.inputTokens - st.cost.cachedInputTokens) * 10 + st.cost.cachedInputTokens * 1 + st.cost.outputTokens * 50) / 1e6;

  broadcast({ type: "persona.step", runId: run.meta.runId, persona: st.id, step: k, reasoning: st.lastReasoning, frame });
  broadcast({ type: "persona.cost", runId: run.meta.runId, persona: st.id, cost: st.cost });
  return k >= N;
}

function buildReport(st) {
  const s = st.script;
  return {
    persona: st.id, summary: s.report.summary, completed: s.completed,
    ...(s.abandonedReason ? { abandonedReason: s.abandonedReason } : {}),
    findings: st.findings, experience: s.report.experience, wouldRecommend: s.report.wouldRecommend,
  };
}

function finishPersona(run, st, opts) {
  if (st.script.abandonedReason) pushEvent(run, st, { kind: "gate", gate: "abandon", detail: st.script.abandonedReason }, opts);
  setStatus(run, st, "reporting", "codex is writing the final report (output-schema PlaytestReport)", opts);
}

function completePersona(run, st, opts) {
  st.report = buildReport(st);
  setStatus(run, st, "done", `report.json written · ${st.findings.length} findings`, opts);
  maybeFinishRun(run);
}

function maybeFinishRun(run) {
  const all = [...run.states.values()];
  if (all.every((s) => ["done", "failed", "stopped"].includes(s.status)) && run.meta.status === "running") {
    run.meta.status = all.some((s) => s.status === "done") ? "done" : "stopped";
    run.meta.finishedAt = new Date().toISOString();
    broadcast({ type: "run.done", runId: run.meta.runId });
  }
}

function schedule(run) {
  for (const st of run.states.values()) {
    const start = ms(900 + st.idx * 700);
    st.timer = setTimeout(() => {
      setStatus(run, st, "starting", run.meta.backend === "modal" ? "creating Modal sandbox, warming Chromium" : "spawning runner, launching Chromium");
      st.timer = setTimeout(() => {
        setStatus(run, st, "playing", `codex exec --json -m gpt-6-astra · budget ${st.config.enforcement.step_budget}`);
        const tick = () => {
          if (st.status !== "playing") return;
          const done = doStep(run, st);
          if (done) {
            finishPersona(run, st);
            st.timer = setTimeout(() => completePersona(run, st), ms(3200));
          } else st.timer = setTimeout(tick, ms(rand(850, 1400)));
        };
        st.timer = setTimeout(tick, ms(600));
      }, ms(2200));
    }, start);
  }
}

/** Synchronously play out a whole run (for the pre-seeded demo run). */
function fastForward(run, startedAt) {
  run.meta.startedAt = startedAt.toISOString();
  let t = 0;
  for (const st of run.states.values()) {
    t = st.idx * 1800;
    setStatus(run, st, "starting", "spawning runner", { t });
    t += 2200;
    setStatus(run, st, "playing", "codex exec --json -m gpt-6-astra", { t });
    let done = false;
    while (!done) { t += 7000 + Math.round(rand(-800, 800)); done = doStep(run, st, { t }); }
    finishPersona(run, st, { t: (t += 4000) });
    completePersona(run, st, { t: (t += 9000) });
  }
  run.meta.finishedAt = new Date(startedAt.getTime() + 41 * 60_000).toISOString();
}

function stopRun(run) {
  for (const st of run.states.values()) {
    clearTimeout(st.timer);
    if (!["done", "failed"].includes(st.status)) setStatus(run, st, "stopped", "stopped from the dashboard");
  }
  maybeFinishRun(run);
}

const personaLive = (run, st) => ({
  id: st.id, status: st.status, steps: st.steps, cost: st.cost, lastReasoning: st.lastReasoning,
  liveUrl: `/api/runs/${run.meta.runId}/${st.id}/live`, streamUrl: `/api/runs/${run.meta.runId}/${st.id}/stream`,
});

function analysisFor(run) {
  const present = new Map(); // config id -> instance ids
  for (const st of run.states.values()) present.set(st.personaId, [...(present.get(st.personaId) ?? []), st.id]);
  const findings = CLUSTERED.map((cf) => {
    const reporters = cf.reporters.flatMap((r) => (present.get(r.persona) ?? []).map((iid) => ({ ...r, persona: iid })));
    const frames = cf.frames.filter((f) => present.has(f.split("/")[0]));
    return { ...cf, reporters, frames };
  }).filter((cf) => cf.reporters.length > 0);
  const found = new Set(findings.map((f) => f.ledgerId).filter(Boolean));
  const score = {
    ...SCORE,
    found: SCORE.found.filter((id) => found.has(id)),
    missed: [...SCORE.missed, ...SCORE.found.filter((id) => !found.has(id))],
    decoysFlagged: SCORE.decoysFlagged.filter((id) => found.has(id)),
    emergent: SCORE.emergent.filter((id) => findings.some((f) => f.id === id)),
  };
  const nonDecoyFound = score.found.filter((id) => !id.startsWith("D")).length;
  score.recall = nonDecoyFound / 15;
  score.precision = (findings.length - score.decoysFlagged.length) / Math.max(1, findings.length);
  return { findings, score, reportMd: REPORT_MD };
}

// ── ZIP (stored, no compression) ────────────────────────────────────────────
function zip(entries) {
  const locals = [], centrals = [];
  let offset = 0;
  for (const [name, content] of entries) {
    const data = Buffer.isBuffer(content) ? content : Buffer.from(content, "utf8");
    const nameB = Buffer.from(name, "utf8");
    const crc = zlib.crc32(data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(0, 8);
    lh.writeUInt16LE(0, 10); lh.writeUInt16LE(0, 12); lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(data.length, 18);
    lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(nameB.length, 26); lh.writeUInt16LE(0, 28);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(0, 10);
    ch.writeUInt16LE(0, 12); ch.writeUInt16LE(0, 14); ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(data.length, 24);
    ch.writeUInt16LE(nameB.length, 28); ch.writeUInt16LE(0, 30); ch.writeUInt16LE(0, 32); ch.writeUInt16LE(0, 34); ch.writeUInt16LE(0, 36);
    ch.writeUInt32LE(0, 38); ch.writeUInt32LE(offset, 42);
    locals.push(lh, nameB, data); centrals.push(ch, nameB);
    offset += lh.length + nameB.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(0, 4); end.writeUInt16LE(0, 6); end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16); end.writeUInt16LE(0, 20);
  return Buffer.concat([...locals, cd, end]);
}

// ── HTTP ────────────────────────────────────────────────────────────────────
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET,POST,OPTIONS", "Access-Control-Allow-Headers": "Content-Type" };
const json = (res, code, body) => { res.writeHead(code, { ...CORS, "Content-Type": "application/json" }); res.end(JSON.stringify(body)); };
const readBody = (req) => new Promise((ok, ko) => { let s = ""; req.on("data", (c) => (s += c)); req.on("end", () => { try { ok(s ? JSON.parse(s) : {}); } catch (e) { ko(e); } }); });
const frameCache = new Map();

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const seg = url.pathname.split("/").filter(Boolean);
  if (req.method === "OPTIONS") { res.writeHead(204, CORS); return res.end(); }
  try {
    if (seg[0] !== "api") return json(res, 404, { error: "not found" });

    // /api/personas
    if (seg[1] === "personas" && seg.length === 2) {
      if (req.method === "GET") return json(res, 200, [...personas.values()]);
      if (req.method === "POST") {
        const p = await readBody(req);
        if (!p?.id || !p?.name || !p?.enforcement) return json(res, 400, { error: "id, name, enforcement are required" });
        if (!/^[a-z0-9][a-z0-9_-]{1,31}$/.test(p.id)) return json(res, 400, { error: "id must be lowercase letters, digits, - or _" });
        const isSeed = fs.existsSync(path.join(PERSONA_DIR, `${p.id}.json`));
        if (isSeed) return json(res, 409, { error: `persona '${p.id}' is a seed persona; choose another id` });
        personas.set(p.id, p); saveLocalPersonas();
        return json(res, 201, p);
      }
    }

    // /api/runs
    if (seg[1] === "runs" && seg.length === 2) {
      if (req.method === "GET") return json(res, 200, [...runs.values()].map((r) => r.meta).sort((a, b) => b.startedAt.localeCompare(a.startedAt)));
      if (req.method === "POST") {
        const body = await readBody(req);
        if (!Array.isArray(body.personas) || body.personas.length === 0) return json(res, 400, { error: "personas[] required" });
        const run = newRun(body);
        schedule(run);
        return json(res, 201, { runId: run.meta.runId });
      }
    }

    if (seg[1] === "runs" && seg.length >= 3) {
      const run = runs.get(seg[2]);
      if (!run) return json(res, 404, { error: `run ${seg[2]} not found` });

      if (seg.length === 3) return json(res, 200, { ...run.meta, personas: [...run.states.values()].map((s) => personaLive(run, s)) });
      if (seg[3] === "stop" && req.method === "POST") { stopRun(run); return json(res, 200, { ok: true }); }
      if (seg[3] === "analysis" && seg.length === 4) {
        if (run.meta.status === "running") {
          const done = [...run.states.values()].filter((s) => s.status === "done").length;
          return json(res, 409, { error: "analysis pending", status: run.meta.status, reportsIn: done, total: run.states.size });
        }
        return json(res, 200, analysisFor(run));
      }
      if (seg[3] === "analysis" && seg[4] === "ask" && req.method === "POST") {
        const { question } = await readBody(req);
        await new Promise((r) => setTimeout(r, ms(1500)));
        return json(res, 200, { answer: pickAnswer(question) });
      }
      if (seg[3] === "export.zip") {
        const entries = [["run.json", JSON.stringify(run.meta, null, 2)]];
        if (run.meta.status !== "running") {
          const a = analysisFor(run);
          entries.push(["analysis/findings.json", JSON.stringify(a.findings, null, 2)], ["analysis/score.json", JSON.stringify(a.score, null, 2)], ["analysis/report.md", a.reportMd]);
        }
        for (const st of run.states.values()) {
          entries.push([`${st.id}/persona.json`, JSON.stringify(st.config, null, 2)], [`${st.id}/session.jsonl`, st.session.map((e) => JSON.stringify(e)).join("\n") + "\n"], [`${st.id}/cost.json`, JSON.stringify(st.cost, null, 2)]);
          if (st.report) entries.push([`${st.id}/report.json`, JSON.stringify(st.report, null, 2)]);
        }
        const buf = zip(entries);
        res.writeHead(200, { ...CORS, "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="${run.meta.runId}.zip"`, "Content-Length": buf.length });
        return res.end(buf);
      }

      // /api/runs/:id/:persona/...
      const st = run.states.get(seg[3]);
      if (!st) return json(res, 404, { error: `persona ${seg[3]} not in run` });
      const sub = seg[4];

      if (sub === "session") return json(res, 200, st.session);
      if (sub === "report") return st.report ? json(res, 200, st.report) : json(res, 404, { error: "report not ready", status: st.status });
      if (sub === "frames") {
        const n = Number(String(seg[5] ?? "").replace(/\.png$/, ""));
        if (!Number.isFinite(n) || n < 1) return json(res, 400, { error: "bad frame index" });
        if (n > Math.max(1, st.steps)) return json(res, 404, { error: "frame not captured yet" });
        const key = `${run.meta.runId}/${st.id}/${n}`;
        let buf = frameCache.get(key);
        if (!buf) {
          buf = await agentPng({ personaName: st.config.name, step: n, room: roomAt(n, st.script.totalSteps), reading: st.config.enforcement.reading });
          if (frameCache.size > 600) frameCache.delete(frameCache.keys().next().value);
          frameCache.set(key, buf);
        }
        res.writeHead(200, { ...CORS, "Content-Type": "image/png", "Cache-Control": "public, max-age=3600", "Content-Length": buf.length });
        return res.end(buf);
      }
      if (sub === "stream") {
        res.writeHead(200, { ...CORS, "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive", "X-Accel-Buffering": "no" });
        res.write(`retry: 2000\n\n`);
        for (const e of st.session) res.write(`data: ${JSON.stringify(e)}\n\n`);
        st.sse.add(res);
        const hb = setInterval(() => res.write(`: hb\n\n`), 15000);
        req.on("close", () => { clearInterval(hb); st.sse.delete(res); });
        return;
      }
      if (sub === "live") {
        res.writeHead(200, { ...CORS, "Content-Type": "multipart/x-mixed-replace; boundary=frame", "Cache-Control": "no-cache, no-store", Connection: "keep-alive", Pragma: "no-cache" });
        st.mjpeg.add(res);
        if (st.lastFrame) writeFrame(res, st.lastFrame);
        req.on("close", () => st.mjpeg.delete(res));
        return;
      }
      return json(res, 404, { error: "not found" });
    }
    return json(res, 404, { error: "not found" });
  } catch (e) {
    console.error(e);
    return json(res, e.status ?? 500, { error: e.message });
  }
});

// ── MJPEG ticker: one render per persona per tick, shared by all viewers ────
function writeFrame(res, buf) {
  res.write(`--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ${buf.length}\r\n\r\n`);
  res.write(buf);
  res.write("\r\n");
}
let rendering = false;
setInterval(async () => {
  if (rendering) return;
  rendering = true;
  const now = Date.now();
  const jobs = [];
  for (const run of runs.values()) for (const st of run.states.values()) {
    if (st.mjpeg.size === 0) continue;
    const frozen = ["done", "failed", "stopped", "queued"].includes(st.status);
    if (frozen && st.lastFrame && now - (st.lastFrameAt ?? 0) < 1500) continue;
    jobs.push((async () => {
      const buf = await liveJpeg({ personaName: st.config.name, step: st.steps, room: st.room, t: frozen ? st.steps * 777 : now });
      st.lastFrame = buf; st.lastFrameAt = now;
      for (const res of st.mjpeg) writeFrame(res, buf);
    })().catch((e) => console.error("frame", e.message)));
  }
  await Promise.all(jobs);
  rendering = false;
}, 333);

// ── WS fleet events ─────────────────────────────────────────────────────────
const wss = new WebSocketServer({ server, path: "/ws" });
const governor = () => {
  let playing = 0;
  for (const run of runs.values()) for (const st of run.states.values()) if (["playing", "reporting"].includes(st.status)) playing++;
  const tpmUsed = Math.round(playing * 62_000 * rand(0.92, 1.08));
  const queued = tpmUsed > TPM_LIMIT ? Math.ceil((tpmUsed - TPM_LIMIT) / 62_000) : 0;
  return { type: "governor", tpmUsed: Math.min(tpmUsed, TPM_LIMIT), tpmLimit: TPM_LIMIT, queued };
};
wss.on("connection", (ws) => { wsClients.add(ws); ws.send(JSON.stringify(governor())); ws.on("close", () => wsClients.delete(ws)); });
setInterval(() => broadcast(governor()), 2000);

// ── Pre-seeded finished demo run so /runs and the report page work at once ──
{
  const demo = newRun({ personas: ["maya", "robert", "sam", "priya", "dana"], seed: 7, backend: "modal" });
  runs.delete(demo.meta.runId);
  demo.meta.runId = "run_demo";
  runs.set("run_demo", demo);
  fastForward(demo, new Date(Date.now() - 2 * 3600_000));
}

server.listen(PORT, () => console.log(`mock orchestrator on http://localhost:${PORT}  (speed x${SPEED}, ${personas.size} personas, demo run: run_demo)`));
