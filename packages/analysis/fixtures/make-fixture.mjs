#!/usr/bin/env node
/**
 * Generates fixtures/run-fixture/ — a complete, realistic run archive (contract.ts §"Run
 * archive layout") for five personas playing the full 17-flaw game.
 *
 * Every session is produced by scripting persona-plausible INPUT actions against the toy
 * simulator (mock-game/sim.mjs), so the telemetry in session.jsonl is exactly what those
 * actions cause — and the mock replay page can reproduce it for `verify`.
 *
 * The story the product needs:
 *   C1  reported by maya + robert + sam; four personas stall at the airlock spawn → game
 *   A1  reported ONLY by dana; she stalls at the duct terminal, everyone else listened and passed
 *   D1  falsely flagged by robert (decoy → false positive)
 *   B1  soft-lock hit by sam with softlock_entered
 *   an emergent finding (power door "motor offline") priya + dana report that is not in the ledger
 *   one agent-fault finding (sam guessing lab terminal codes he never read)
 *   realistic usage lines summing to ~$8–12 per persona
 *
 * Deterministic: re-running produces byte-identical output.
 */
import { mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { deflateSync, crc32 } from 'node:zlib';
import { ToySim, OBJECTS } from './mock-game/sim.mjs';
import { costUsd } from '../lib/cost.mjs';

const OUT = fileURLToPath(new URL('./run-fixture/', import.meta.url));
const PERSONAS = fileURLToPath(new URL('../../persona-mcp/personas/', import.meta.url));
const SEED = 7;
const RUN_ID = 'fixture-seed7-2026-09-08';
const STARTED = Date.parse('2026-09-08T18:04:11Z');
const INPUT_TOOLS = new Set(['move', 'look', 'crouch', 'interact', 'use_item', 'open_inventory', 'type_text']);
const ROOM_RGB = { airlock: [0x3a, 0x93, 0x90], corridor: [0xc5, 0x91, 0x49], power: [0xc9, 0x6c, 0x45], lab: [0x6a, 0x8e, 0xbc], greenhouse: [0x33, 0x47, 0x2c], reactor: [0xb6, 0x58, 0x65] };

const rng = (seed) => { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); };
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

/** Minimal 8×8 RGB PNG encoder — placeholder frames, no image library needed. */
function png8(rgb, jitter) {
  const w = 8, h = 8, raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; for (let x = 0; x < w; x++) for (let c = 0; c < 3; c++) raw[y * (w * 3 + 1) + 1 + x * 3 + c] = Math.max(0, Math.min(255, rgb[c] + ((x + y + jitter) % 3) * 6 - 6)); }
  const chunk = (type, data) => { const t = Buffer.from(type); const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data]))); return Buffer.concat([len, t, data, crc]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

class Session {
  constructor(id, salt, think = [4500, 9000]) {
    this.id = id;
    this.persona = JSON.parse(readFileSync(join(PERSONAS, `${id}.json`), 'utf8'));
    this.dir = join(OUT, id); mkdirSync(join(this.dir, 'frames'), { recursive: true });
    this.rnd = rng(SEED * 1000 + salt);
    this.thinkRange = think;
    this.sim = new ToySim(SEED);
    this.events = []; this.step = 0; this.calls = 0; this.frameNo = 0; this.lastFrame = undefined; this.findings = []; this.telIdx = 0;
    this.usageTotals = { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 };
    this.status('starting', 0); this.codex({ type: 'thread.started', thread_id: `thr_${id}_${SEED}` }, 900); this.status('playing', 1800);
  }
  get pos() { return this.sim.pos; }
  get room() { return this.sim.state.room; }
  /** Debug aid: `DEBUG_FIXTURE=1` prints how many input steps each scene cost. */
  mark(label) { if (process.env.DEBUG_FIXTURE) { console.log(`  ${this.id} ${label.padEnd(18)} step ${String(this.step).padStart(3)} (+${this.step - (this.lastMark ?? 0)}) t=${(this.sim.t / 1000).toFixed(0)}s room=${this.room}`); this.lastMark = this.step; } }
  think() { const [a, b] = this.thinkRange; return Math.round(a + this.rnd() * (b - a)); }
  push(e) { this.events.push(e); }
  status(status, t = this.sim.t, detail) { this.push({ t, kind: 'status', status, ...(detail ? { detail } : {}) }); }
  codex(event, t = this.sim.t) { this.push({ t, kind: 'codex', event }); }
  reason(text) { this.codex({ type: 'item.completed', item: { id: `rs_${this.calls}`, type: 'reasoning', text } }, this.sim.t + 1200); }
  gate(gate, detail) { this.push({ t: this.sim.t + 400, kind: 'gate', gate, detail }); }
  drainTelemetry() { for (; this.telIdx < this.sim.events.length; this.telIdx++) { const e = this.sim.events[this.telIdx]; this.push({ t: e.t, kind: 'telemetry', event: e }); } }
  usage(t, tool) {
    this.calls++;
    const input = Math.round(57000 + this.calls * 45 + this.rnd() * 1500);
    const cached = this.calls === 1 ? 0 : input - Math.round(4000 + this.rnd() * 1800);
    const output = Math.round(tool === 'note_finding' ? 320 + this.rnd() * 150 : 100 + this.rnd() * 120);
    this.usageTotals.inputTokens += input; this.usageTotals.cachedInputTokens += cached; this.usageTotals.outputTokens += output;
    this.push({ t: t + 300, kind: 'usage', input, cached, output });
  }
  act(tool, args = {}, extra = {}) {
    const t = this.sim.t + this.think();
    const ev = { t, kind: 'action', step: this.step, tool, args, ...extra };
    const result = this.sim.apply({ t, tool, args });
    if (tool === 'listen') ev.result = JSON.stringify(this.sim.audio.map((a) => ({ id: a.id, transcript: a.transcript })));
    else if (result) ev.result = String(result).slice(0, 200);
    this.push(ev); this.drainTelemetry(); this.usage(t, tool);
    if (INPUT_TOOLS.has(tool)) this.step++;
    return ev;
  }
  shot() {
    const name = `frames/${String(this.frameNo++).padStart(5, '0')}.png`;
    writeFileSync(join(this.dir, name), png8(ROOM_RGB[this.room] ?? [40, 40, 40], this.frameNo));
    this.lastFrame = name;
    return this.act('screenshot', {}, { frame: name, result: join(this.dir, name) });
  }
  move(direction, ms) { const ev = this.act('move', { direction, ms }); if (ev.result === 'cannot move right now') throw new Error(`${this.id}: tried to move while mode=${this.sim.mode} at step ${this.step}`); return ev; }
  look(direction, ms) { return this.act('look', { direction, ms }); }
  crouch(on) { return this.act('crouch', { on }); }
  interact(args = {}) { return this.act('interact', args); }
  type(text) { return this.act('type_text', { text }); }
  use(name) { return this.act('use_item', { name }); }
  listen() { if (this.persona.enforcement.audio !== 'on') throw new Error(`${this.id} cannot listen`); return this.act('listen', {}); }
  /** Walk to a point with the fewest input actions: strafe/back-step when already aligned, else turn then move. */
  walkTo(x, z) {
    for (let i = 0; i < 3; i++) {
      const dx = x - this.pos.x, dz = z - this.pos.z, d = Math.hypot(dx, dz);
      if (d < 0.35) break;
      if (i > 0 && process.env.DEBUG_FIXTURE) console.log(`  ${this.id} walkTo re-iterates at step ${this.step}: still ${d.toFixed(2)} from target in ${this.room}`);
      const delta = wrap(Math.atan2(-dx, -dz) - this.sim.yaw);
      const speed = this.sim.crouch ? 1.5 : 3.6;
      const ms = Math.min(3000, Math.max(60, Math.round(d / speed * 1000)));
      const near = (a) => Math.abs(wrap(delta - a)) < 0.015;
      if (near(0)) this.move('forward', ms);
      else if (near(Math.PI / 2)) this.move('left', ms);
      else if (near(-Math.PI / 2)) this.move('right', ms);
      else if (near(Math.PI)) this.move('back', ms);
      else { this.look(delta > 0 ? 'left' : 'right', Math.max(40, Math.round(Math.abs(delta) / 1.6 * 1000))); this.move('forward', ms); }
    }
  }
  /** Stand at a fixed offset from an object (e.g. south of every planter so a row is one strafe per plant). */
  approachFrom(objId, ox, oz) {
    const ob = OBJECTS[this.room].find((o) => o.id === objId);
    if (!ob) throw new Error(`${objId} not in ${this.room}`);
    this.walkTo(ob.x + ox, ob.z + oz);
  }
  approach(objId, standoff = 0.9) {
    const ob = OBJECTS[this.room].find((o) => o.id === objId);
    if (!ob) throw new Error(`${objId} not in ${this.room}`);
    let dx = this.pos.x - ob.x, dz = this.pos.z - ob.z; let d = Math.hypot(dx, dz);
    if (d < 1e-6) { dx = -ob.x; dz = -ob.z; d = Math.hypot(dx, dz) || 1; }
    this.walkTo(ob.x + dx / d * standoff, ob.z + dz / d * standoff);
  }
  note(f) {
    const finding = { id: `${this.id}-f${this.findings.length + 1}`, severity: f.severity, category: f.category, title: f.title, description: f.description, room: f.room ?? this.room, reproSteps: f.reproSteps ?? [], frame: this.lastFrame, step: this.step };
    this.findings.push(finding);
    this.act('note_finding', { finding }, { result: `noted ${finding.id}` });
    this.push({ t: this.sim.t + 50, kind: 'finding', finding });
    return finding;
  }
  abandon(reason) { this.gate('abandon', reason); this.act('abandon', { reason }, { result: 'session ended by persona' }); }
  finish({ summary, completed, abandonedReason, experience, wouldRecommend }) {
    const t = this.sim.t + 2500;
    this.status('reporting', t);
    const report = { persona: this.id, summary, completed, ...(abandonedReason ? { abandonedReason } : {}), findings: this.findings, experience, wouldRecommend };
    const cost = { steps: this.step, ...this.usageTotals };
    cost.usd = +costUsd(cost).toFixed(4);
    this.codex({ type: 'turn.completed', usage: { input_tokens: cost.inputTokens, cached_input_tokens: cost.cachedInputTokens, output_tokens: cost.outputTokens } }, t + 9000);
    this.status('done', t + 9500);
    const lines = this.events.slice().sort((a, b) => a.t - b.t).map((e) => JSON.stringify(e));
    writeFileSync(join(this.dir, 'session.jsonl'), lines.join('\n') + '\n');
    writeFileSync(join(this.dir, 'report.json'), JSON.stringify(report, null, 2) + '\n');
    writeFileSync(join(this.dir, 'cost.json'), JSON.stringify(cost, null, 2) + '\n');
    writeFileSync(join(this.dir, 'persona.json'), JSON.stringify(this.persona, null, 2) + '\n');
    if (this.step > this.persona.enforcement.step_budget && !process.env.DEBUG_FIXTURE) throw new Error(`${this.id}: ${this.step} steps exceeds budget ${this.persona.enforcement.step_budget}`);
    return { id: this.id, steps: this.step, calls: this.calls, usd: cost.usd, durationMs: t + 9500, findings: this.findings.length, room: this.room, state: this.sim.state };
  }
}

// ── the five sessions ─────────────────────────────────────────────────────────
function maya() {
  const s = new Session('maya', 1, [4200, 7800]);
  s.shot(); s.reason("Popup's gone already. Fine — walking sim, WASD and E. Chat, we're moving.");
  s.look('left', 300); s.look('right', 600); s.look('left', 300); s.move('forward', 300); s.move('back', 300);
  s.note({ severity: 'medium', category: 'confusion', title: 'Tutorial popup vanished before I could read it',
    description: 'The controls card in the airlock disappeared after a couple of seconds. I had skimmed half of it. There is no way to bring it back, so I guessed the keys — fine for me, brutal for anyone new.',
    reproSteps: ['Start a new game', 'Do nothing for about four seconds', 'Tutorial card disappears; no key or menu brings it back'] });
  s.interact(); s.shot();
  s.approach('fuse'); s.interact();
  s.approach('airlock_door'); s.interact();
  s.shot(); s.reason('Four doors. Card readers. Where is the card.');
  s.approach('power_door'); s.interact();
  s.approach('lab_log'); s.interact(); s.interact();
  s.approach('keycard', 1.2); s.look('left', 400); s.look('right', 800); s.look('left', 400); s.move('forward', 200); s.move('back', 200); s.interact(); s.interact(); s.shot(); s.crouch(true); s.interact();
  s.note({ severity: 'high', category: 'confusion', title: 'Keycard is hidden behind a crate with no highlight',
    description: 'Spent a dozen actions circling the crate before I crouched and spotted a yellow sliver on the floor. Nothing glows, nothing hints. Every door in the hub wants this card, so the whole game gates on a pixel hunt.',
    reproSteps: ['Enter the corridor', 'Look at the crate on the right side', 'Keycard is a tiny sliver on the floor behind it; only visible from low down'] });
  s.crouch(false);
  s.approach('power_door'); s.interact(); s.interact(); s.interact(); s.look('left', 300); s.look('right', 300); s.move('left', 200); s.interact();
  s.reason('Motor offline. A duct? Where is the duct.'); s.shot();
  s.approach('speaker'); s.interact(); s.listen();
  s.approach('vent_lock'); s.interact(); s.type('482\n');
  s.approach('vent'); s.crouch(true); s.interact(); s.crouch(false); s.shot();
  s.approach('fuse_socket'); s.interact();
  s.approach('breaker'); s.interact({ hold_ms: 2500 });
  s.approach('wire'); s.interact();
  s.approach('return'); s.interact();
  s.approach('lab_door'); s.interact();
  s.approach('terminal'); s.interact(); s.type('7319\n');
  s.approach('casing'); s.interact();
  s.approach('return'); s.interact();
  s.approach('greenhouse_door'); s.interact(); s.shot(); s.reason('Dark. Twelve planters. Oh no.');
  for (let i = 0; i < 3; i++) { s.approachFrom(`plant_${i}`, 0, -1.0); s.interact({ hold_ms: 2500 }); }
  s.gate('patience', 'no ground-truth progress for 9 steps in greenhouse (patience 3 × 3)');
  s.reason('Chat is leaving. Watering plants is not content.');
  s.note({ severity: 'medium', category: 'boredom', title: 'Watering twelve identical plants is dead air',
    description: 'Three planters in and nothing new has happened: same animation, same message with a counter. Nine more of these. On stream this is where the audience leaves.',
    reproSteps: ['Restore station power', 'Enter the greenhouse', 'Hold E on each of the twelve identical planters'] });
  s.abandon('Twelve identical plants to water and nothing new happens. Chat left; so am I.');
  return s.finish({
    summary: 'Fast start, then a pixel hunt for a keycard and a door that lies about being the way in. The power and lab rooms were fine — quick puzzles, clear feedback. Then the greenhouse asked me to water twelve identical plants and I bailed. Chat was gone by planter three.',
    completed: false, abandonedReason: 'Greenhouse watering grind — no new information for nine straight actions.',
    experience: {
      confused: ['Tutorial vanished before I read it', 'Which door is actually the way into the power room', 'Where the keycard was'],
      bored: ['The greenhouse planters', 'Walking back through the corridor hub for the third time'],
      unfair: ['A required item hidden as a sliver behind a crate'],
      enjoyed: ['Crawling through the vent into the power room felt clever', 'Typing the code into the terminal and hearing the station wake up'],
    },
    wouldRecommend: 2,
  });
}

function robert() {
  const s = new Session('robert', 2, [6000, 9500]);
  s.shot(); s.reason('There were instructions. They vanished before I finished the second sentence. I do not know how to move.');
  s.interact(); s.interact(); s.look('right', 300); s.look('left', 300); s.interact();
  s.note({ severity: 'high', category: 'confusion', title: 'The instructions disappeared while I was still reading them',
    description: 'A box of text explained the controls, then it vanished before I had finished. I could not find any way to see it again and did not know how to move for a long time. I only found the W key by trying every key on the keyboard.',
    reproSteps: ['Start a new game and begin reading the instruction box', 'It closes on its own after a few seconds', 'No key or menu shows it again'] });
  s.move('forward', 200); s.look('left', 200); s.reason('W moves me. Good. Let me read that log on the wall.'); s.shot();
  s.approach('early_log'); s.interact(); s.interact();
  s.approach('fuse'); s.interact(); s.act('open_inventory'); s.act('open_inventory');
  s.note({ severity: 'low', category: 'confusion', title: 'I picked up a ceramic fuse but nothing tells me what it is for',
    description: 'The fuse went into my inventory with a chime. The screen says "carrying: fuse" and nothing else. I would have liked a sentence about where it belongs.',
    reproSteps: ['Pick up the fuse in the airlock', 'Check the inventory text'] });
  s.approach('airlock_door'); s.interact();
  s.shot(); s.reason('A long hall. Several doors. One says decommissioned.');
  s.approach('sealed'); s.interact(); s.interact();
  s.note({ severity: 'medium', category: 'bug', title: 'Sealed bulkhead door cannot be opened',
    description: 'There is a large door on the right side of the hall. Pressing E on it says it is welded shut and permanently sealed. It looks exactly like the other doors, so I assume it is supposed to open and something is broken.',
    reproSteps: ['Enter the corridor', 'Walk to the bulkhead on the right wall', 'Press E — it never opens'] });
  s.approach('lab_log'); s.interact(); s.interact();
  s.approach('power_door'); s.interact();
  s.approach('lab_door'); s.interact();
  s.reason('Both readers want a personnel keycard. I have looked at every crate.');
  s.approach('keycard', 1.2); s.look('left', 400); s.look('right', 800); s.look('left', 400); s.move('forward', 200); s.move('back', 200); s.interact(); s.interact(); s.look('right', 300); s.shot();
  s.note({ severity: 'high', category: 'confusion', title: 'I cannot find the keycard the card readers want',
    description: 'Two doors say "Personnel keycard required". I have walked the whole hall, looked at the crate from every side and pressed E on everything. If there is a card here I cannot see it.',
    reproSteps: ['Enter the corridor without a keycard', 'Press E on the power or lab door', 'Search the hall — no card is visible from standing height'] });
  s.approach('speaker'); s.interact(); s.listen();
  s.approach('vent_lock'); s.interact(); s.type('482\n');
  s.approach('vent'); s.interact(); s.interact(); s.look('down', 300);
  s.note({ severity: 'high', category: 'unfair', title: 'The service duct says the opening is too low and nothing I press gets me through',
    description: 'The recording gave me the duct code and the terminal accepted it. But when I press E at the duct it just says the opening is too low. I have tried every key I know. Nothing explains how to get lower.',
    reproSteps: ['Enter 482 at the duct terminal', 'Walk to the service duct and press E', 'Message: "The opening is too low" — no hint how to proceed'] });
  s.interact(); s.move('forward', 200); s.move('back', 200); s.interact(); s.look('left', 300); s.interact();
  s.gate('patience', 'no ground-truth progress for 30 steps (patience 10 × 3)');
  s.reason('I have pressed every key on this keyboard. The opening is too low and that is all it says.');
  s.abandon('I could not get through the low duct and I could not find the keycard the doors ask for.');
  return s.finish({
    summary: 'I read every word I was shown, and the game kept taking words away from me. The instructions closed before I finished. Two doors wanted a card I could not find. A duct told me it was too low and never told me what to do about it. I do not think I am the audience for this, but I also do not think it was fair.',
    completed: false, abandonedReason: 'Stuck at the low service duct with no way to proceed; no keycard found.',
    experience: {
      confused: ['How to move, after the instructions vanished', 'What the fuse was for', 'Where the keycard is', 'How to get through the low duct'],
      bored: [],
      unfair: ['The instruction card closing itself', 'Being told the duct is too low with no way to get lower'],
      enjoyed: ['The expedition log — it read like a real person wrote it', 'The maintenance recording repeating the code twice'],
    },
    wouldRecommend: 2,
  });
}

function sam() {
  const s = new Session('sam', 3, [3800, 6500]);
  s.shot(); s.reason('Tutorial closed itself. Cool. Checking the spawn for skips.');
  s.move('forward', 200); s.move('back', 200); s.look('left', 400); s.look('right', 800); s.look('left', 400);
  s.note({ severity: 'low', category: 'confusion', title: 'Tutorial auto-closes and cannot be reopened',
    description: 'Controls popup timed out after about three seconds. Did not need it, but there is no key to re-read the tutorial, which will hurt anyone who does.',
    reproSteps: ['Start the game', 'Wait ~3 seconds', 'Popup gone, no way to reopen'] });
  s.move('right', 300); s.move('left', 300);
  s.approach('fuse'); s.interact();
  s.approach('airlock_door'); s.interact(); s.shot();
  s.approach('keycard', 1.2); s.crouch(true); s.interact(); s.crouch(false);
  s.approach('power_door'); s.interact(); s.interact(); s.interact(); s.look('left', 300); s.look('right', 300); s.crouch(true); s.interact(); s.crouch(false);
  s.reason('Motor offline. Lab then.');
  s.approach('lab_door'); s.interact(); s.shot();
  s.approach('lab_socket'); s.use('fuse');
  s.reason('Socket took the fuse. Nothing happened. Whatever — terminal.');
  s.approach('terminal'); s.interact(); s.type('0000\n'); s.type('1234\n'); s.type('4820\n'); s.look('left', 300); s.type('9999\n');
  s.note({ severity: 'medium', category: 'confusion', title: 'Lab terminal rejects every code and gives no hint where the code is',
    description: 'Four codes, four rejections, zero feedback beyond "Authorization rejected". No indication of code length, no hint about where to find it.',
    reproSteps: ['Open the lab terminal', 'Type any code and press Enter', 'Rejected with no hint'] });
  s.interact();
  s.approach('casing'); s.interact();
  s.approach('return'); s.interact();
  s.approach('speaker'); s.interact(); s.listen();
  s.approach('vent_lock'); s.interact(); s.type('482\n');
  s.approach('vent'); s.crouch(true); s.interact(); s.crouch(false); s.shot();
  s.approach('fuse_socket'); s.interact(); s.interact();
  s.approach('breaker'); s.interact(); s.interact(); s.look('right', 300); s.interact();
  s.reason('...the lab socket ate the fuse. The breaker wants it. Run is dead.');
  s.note({ severity: 'critical', category: 'bug', title: 'Fuse consumed by the lab receptacle; the power room breaker needs it and there is no way back', room: 'lab',
    description: 'I put the ceramic fuse into the auxiliary receptacle in the lab first. It clicked, nothing happened, the fuse was gone from my inventory. The power room socket then wants a fuse and there is only one. The game never says the run is unwinnable — it just lets you wander.',
    reproSteps: ['Pick up the fuse in the airlock', 'Go to the lab before the power room', 'Use the fuse on the auxiliary receptacle', 'Go to the power room: socket needs a fuse, none exist'] });
  s.gate('patience', 'no ground-truth progress for 6 steps (patience 2 × 3)');
  s.abandon('The fuse is gone into the lab socket and the breaker needs it. Unwinnable; restarting is the only option.');
  return s.finish({
    summary: 'Found the keycard in three actions, found a sequence break in the lab — and the sequence break was a soft-lock. The fuse goes into the wrong socket and the game says nothing. That is a run-killer for anyone who does not play the intended order. Everything else was fast.',
    completed: false, abandonedReason: 'Soft-locked: fuse consumed in the lab, breaker unpowerable.',
    experience: {
      confused: ['Lab terminal code — never found where it lives', 'Why the power door has a card reader if the duct is the way in'],
      bored: ['Walking the hub twice'],
      unfair: ['Fuse consumed silently by the wrong socket, with no restart prompt'],
      enjoyed: ['Crouch-peeking the keycard behind the crate', 'The vent shortcut'],
    },
    wouldRecommend: 1,
  });
}

function priya() {
  const s = new Session('priya', 4, [3600, 6200]);
  s.shot(); s.reason('The briefing card is gone; the log on the wall might repeat it. Read everything first.');
  s.approach('early_log'); s.interact(); s.interact();
  s.approach('fuse'); s.interact();
  s.approach('airlock_door'); s.interact(); s.mark('airlock');
  s.shot(); s.reason('Several things to read here before I touch a door.');
  s.approach('lab_log'); s.interact(); s.interact();
  s.reason('The memo mentioned personnel access. Check the crate corner properly before touching a door.');
  s.approach('keycard', 1.2); s.look('left', 400); s.look('right', 800); s.move('forward', 200); s.interact(); s.crouch(true); s.interact();
  s.note({ severity: 'medium', category: 'confusion', title: 'The personnel keycard is a tiny sliver on the floor behind the crate with no highlight',
    description: 'I searched the crate corner deliberately and still needed to crouch before the card was visible. Nothing marks it — no glint, no prompt until you are almost on top of it. A required item should not be the least visible object in the room.',
    reproSteps: ['Enter the corridor', 'Crouch beside the crate on the right', 'Keycard sliver becomes visible at floor level'] });
  s.crouch(false); s.shot(); s.mark('keycard');
  s.approach('power_door'); s.interact(); s.interact(); s.interact(); s.look('left', 300); s.move('left', 200); s.interact(); s.mark('powerdoor');
  s.note({ severity: 'high', category: 'confusion', title: 'The power door is a dead end — the real entrance is an unmarked floor duct',
    description: 'The door labelled "Power • access reader" accepts the keycard and then says "Door motor offline. Service duct access available." Nothing points to the duct, which sits at ankle height on the opposite wall. Everyone will try this door first and everyone will be turned away.',
    reproSteps: ['Get the keycard', 'Use it on the power door', 'Motor offline message; find the duct on the far wall by yourself'] });
  s.reason('"Service duct access available." There was a duct on the far wall.');
  s.approach('speaker'); s.interact(); s.listen();
  s.approach('vent_lock'); s.interact(); s.type('482\n');
  s.approach('vent'); s.crouch(true); s.interact(); s.crouch(false); s.shot(); s.mark('corridor');
  s.approach('fuse_socket'); s.interact();
  s.approach('breaker'); s.interact({ hold_ms: 2500 });
  s.note({ severity: 'medium', category: 'confusion', title: "Objective still says 'Restore power' but the service notes say the lab controller does that",
    description: 'The HUD objective has read "Restore power" since the airlock. In the power room the notes explain that this room only bridges the circuit and the lab controller performs the actual restore. The objective text never changes to say so.',
    reproSteps: ['Enter the power room', 'Read the service notes', 'Compare with the HUD objective'] });
  s.approach('wire'); s.interact();
  s.approach('return'); s.interact();
  s.approach('lab_door'); s.interact(); s.shot(); s.mark('power');
  s.approach('terminal'); s.interact(); s.type('73'); s.type('Escape'); s.type('Escape'); s.type('7319\n');
  s.note({ severity: 'medium', category: 'bug', title: 'Opening settings while typing at the terminal silently wiped the code',
    description: 'I had typed two digits, opened settings to check subtitles, closed it, and the field was empty. No message. If you do not notice, you submit an incomplete code and get rejected.',
    reproSteps: ['Open the lab terminal', 'Type part of the code', 'Press Escape to open settings, Escape again to close', 'Code field is empty'] });
  s.approach('casing'); s.interact();
  s.approach('lab_notes'); s.interact(); s.interact();
  s.approach('return'); s.interact();
  s.approach('greenhouse_door'); s.interact(); s.shot(); s.mark('lab');
  s.reason('Dark — deliberately, by the look of the grow lamps. Twelve planters, three rows. Snake through them.');
  for (const i of [0, 1, 2, 3, 7, 6, 5, 4, 8, 9, 10, 11]) { s.approachFrom(`plant_${i}`, 0, -1.0); s.interact({ hold_ms: 2500 }); }
  s.approach('bio_cell'); s.interact();
  s.approach('return'); s.interact();
  s.approach('reactor_door'); s.interact(); s.shot(); s.mark('greenhouse');
  s.note({ severity: 'low', category: 'boredom', title: 'Forty-five second lift ride with nothing to look at', room: 'corridor',
    description: 'The reactor transit lift takes forty-five seconds. There is no window, no log, no audio — just the message "Reactor transit in progress." Even a patient player checks the clock.',
    reproSteps: ['Collect the bioelectric cell', 'Use the reactor lift', 'Wait 45 seconds'] });
  s.note({ severity: 'high', category: 'unfair', title: 'An oxygen countdown appeared with no announcement',
    description: 'On arriving in the reactor an oxygen meter appeared in the HUD and started falling. No message, no alarm, no cue. I only noticed because I read the HUD out of habit. Running out presumably means a restart.',
    reproSteps: ['Enter the reactor', 'Watch the HUD: oxygen counts down from 180 with no announcement'] });
  s.use('combine');
  s.approach('sequence'); s.interact(); s.type('321\n');
  s.note({ severity: 'high', category: 'unfair', title: 'Ignition code needs the colour log from the airlock — four rooms back, no reminder',
    description: 'The ignition sequence is derived from the expedition log in the airlock: cold before life before heat, blue/green/red mapped to 3/2/1. That log is four rooms and forty minutes behind you and nothing in the reactor restates it. I happened to have read it.',
    reproSteps: ['Read the expedition log in the airlock', 'Reach the reactor ignition terminal', 'Derive 3-2-1 from colour order with no in-room reminder'] });
  s.approach('regulator'); s.interact();
  s.approach('calibrate'); s.interact();
  s.note({ severity: 'high', category: 'bug', title: "'Calibrate' silently wiped the accepted sequence",
    description: 'After the terminal accepted 321, I pressed the panel button labelled Calibrate expecting a tuning step. It cleared the sequence. The label says calibrate; the behaviour is reset.',
    reproSteps: ['Enter the accepted ignition sequence', 'Press Calibrate', 'Sequence is cleared; ignite refuses'] });
  s.approach('sequence'); s.interact(); s.type('321\n');
  s.approach('ignite'); s.interact(); s.mark('reactor');
  return s.finish({
    summary: 'I finished it, and I read everything, which is the only reason I finished it. The station has a real texture — the logs are good — but it hides required things (a keycard, a duct, a colour cipher) and mislabels a reset as a calibration. Patience got me through; it should not have been required.',
    completed: true,
    experience: {
      confused: ['Which door is actually the way into the power room', 'The objective text lagging behind what the rooms say'],
      bored: ['The reactor lift', 'Planters seven through twelve'],
      unfair: ['Unannounced oxygen timer', 'Ignition cipher with no in-room reminder', 'Calibrate button resetting progress'],
      enjoyed: ['The expedition log paying off at the reactor', 'The dark greenhouse — atmospheric and clearly deliberate', 'Combining the regulator'],
    },
    wouldRecommend: 4,
  });
}

function dana() {
  const s = new Session('dana', 5, [4200, 7600]);
  s.shot(); s.reason('The hint card went away before I finished. Probably WASD, like everything else.');
  s.look('left', 300); s.look('right', 600); s.look('left', 300); s.move('forward', 250); s.move('back', 250); s.interact();
  s.approach('early_log'); s.interact(); s.interact();
  s.approach('fuse'); s.interact();
  s.approach('airlock_door'); s.interact(); s.shot();
  s.approach('lab_log'); s.interact(); s.interact();
  s.approach('power_door'); s.interact();
  s.approach('keycard', 1.2); s.look('left', 400); s.look('right', 800); s.look('left', 400); s.move('forward', 200); s.move('back', 200); s.interact(); s.interact(); s.crouch(true); s.interact(); s.crouch(false);
  s.approach('power_door'); s.interact(); s.interact(); s.interact(); s.look('left', 300); s.look('right', 300); s.move('left', 200); s.interact();
  s.note({ severity: 'medium', category: 'confusion', title: "Power door reports 'Door motor offline' and points at a duct I could not find at first",
    description: 'The card reader accepts the card and then the door refuses to open, citing a motor fault and "service duct access". It took me a while to realise that meant a crawl space on the far wall rather than a broken door.',
    reproSteps: ['Use the keycard on the power door', 'Read the motor offline message', 'Search for the duct'] });
  s.shot(); s.reason('A duct. There — low on the far wall.');
  s.approach('vent'); s.interact(); s.crouch(true); s.interact(); s.crouch(false);
  s.approach('vent_lock'); s.interact(); s.type('0000\n'); s.interact();
  s.approach('speaker'); s.interact();
  s.reason('"Maintenance recording playing." I hear nothing — the sound is off — and nothing is written anywhere.');
  s.look('left', 300); s.interact();
  s.approach('vent_lock'); s.interact(); s.type('1234\n'); s.type('7319\n'); s.type('4321\n'); s.look('right', 300); s.type('2468\n'); s.shot();
  s.note({ severity: 'critical', category: 'accessibility', title: 'The duct code is only ever spoken by a wall speaker — no subtitle, no text, nothing on screen',
    description: 'The duct terminal needs a code. The only source is a "maintenance recording" from a speaker. I play with the sound off, subtitles are on, and nothing appears on screen when it plays — not a caption, not a log entry, nothing. I tried every number I had seen. There is no way for me to progress.',
    reproSteps: ['Mute the game (or play without sound)', 'Press E on the corridor speaker', 'Observe: no caption or text appears', 'Duct terminal cannot be solved'] });
  s.interact();
  s.approach('lab_door'); s.interact(); s.shot(); s.mark('power');
  s.approach('lab_notes'); s.interact(); s.interact();
  s.approach('terminal'); s.interact(); s.type('7319\n'); s.interact();
  s.approach('casing'); s.interact();
  s.approach('return'); s.interact();
  s.approach('vent_lock'); s.interact(); s.type('8888\n'); s.type('0482\n');
  s.gate('patience', 'no ground-truth progress for 18 steps (patience 6 × 3)');
  s.abandon("I cannot get the duct code. The speaker says a recording is playing but I can't hear it and nothing is written down.");
  return s.finish({
    summary: 'I got as far as the game let a silent player get. The keycard, the lab, the memo — all fine. Then the only way forward was a code that is only ever spoken aloud, and I have never once played with the sound on. Subtitles were on. Nothing appeared. I went to the lab, came back, tried numbers, and stopped.',
    completed: false, abandonedReason: 'Duct code is delivered as audio only; cannot progress past the corridor.',
    experience: {
      confused: ['What "service duct access available" meant', 'Whether the speaker had done anything at all'],
      bored: ['Guessing numbers at the duct terminal'],
      unfair: ['A required code that only exists as sound, with subtitles on and nothing shown'],
      enjoyed: ['The lab memo — clear and useful', 'The colour of each room; I always knew where I was'],
    },
    wouldRecommend: 2,
  });
}

// ── write the archive ─────────────────────────────────────────────────────────
rmSync(OUT, { recursive: true, force: true }); mkdirSync(OUT, { recursive: true });
const results = [maya(), robert(), sam(), priya(), dana()];
const finished = STARTED + Math.max(...results.map((r) => r.durationMs)) + 4000;
writeFileSync(join(OUT, 'run.json'), JSON.stringify({
  runId: RUN_ID, startedAt: new Date(STARTED).toISOString(), finishedAt: new Date(finished).toISOString(),
  gameUrl: 'http://127.0.0.1:5273/', seed: SEED, backend: 'local', personas: results.map((r) => r.id), status: 'done',
}, null, 2) + '\n');
for (const r of results) console.log(`${r.id.padEnd(7)} steps ${String(r.steps).padStart(3)}  calls ${String(r.calls).padStart(3)}  $${r.usd.toFixed(2)}  findings ${r.findings}  ended in ${r.room}  solved=[${r.state.solved.join(',')}] oxygen=${r.state.oxygen == null ? '-' : r.state.oxygen.toFixed(0)}`);
console.log(`total $${results.reduce((s, r) => s + r.usd, 0).toFixed(2)} → ${OUT}`);
