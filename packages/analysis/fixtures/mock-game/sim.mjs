/**
 * ToySim — a tiny, deterministic stand-in for Station Kepler.
 *
 * It speaks the same *input* vocabulary the runner's MCP tools expose (move, look,
 * crouch, interact, use_item, open_inventory, type_text, listen) and emits the same
 * GameEvent telemetry shape the real game does (contract.ts §GameEvent), including
 * every ledger flaw id. Rooms, object coordinates and puzzle rules mirror
 * apps/game/src/world.js + engine.js closely enough that the fixture's stories are
 * plausible, but this is NOT the game — it is the model that generated the fixture
 * and the model the mock replay page re-runs so `verify` can be proven end to end.
 *
 * Runs in Node and in the browser (no imports).
 */

export const ROOMS = ['airlock', 'corridor', 'power', 'lab', 'greenhouse', 'reactor'];

const o = (id, x, z, extra = {}) => ({ id, x, z, ...extra });
export const OBJECTS = {
  airlock: [o('airlock_door', 0, -6.6), o('early_log', -4.5, -4), o('fuse', 4, -3, { pickup: true })],
  corridor: [
    o('power_door', -5, -6.6), o('lab_door', -1.7, -6.6), o('greenhouse_door', 1.7, -6.6), o('reactor_door', 5, -6.6),
    o('return', 0, 6.6), o('sealed', 6.6, 1), o('vent', -6.4, 1), o('speaker', -5, -3), o('vent_lock', -6.1, 3.3),
    o('keycard', 3.3, 1.85, { pickup: true, hidden: true }), o('lab_log', 4.6, -2.5),
  ],
  power: [o('return', 0, 6.6), o('fuse_socket', -3, -4.5), o('breaker', 3, -4.5), o('wire', 4, 0, { pickup: true }), o('power_log', -4, 0)],
  lab: [o('return', 0, 6.6), o('lab_socket', -4, -4.5), o('terminal', 0, -4.5), o('casing', 4, -3, { pickup: true }), o('lab_notes', -4, 0)],
  greenhouse: [
    o('return', 0, 6.6), o('grow_log', -5, 3),
    ...Array.from({ length: 12 }, (_, i) => o(`plant_${i}`, -4.5 + (i % 4) * 3, -4 + Math.floor(i / 4) * 3)),
    o('bio_cell', 5.8, 4.5, { pickup: true }),
  ],
  reactor: [o('return', 0, 6.6), o('regulator', -4, -3.5), o('sequence', 0, -4.8), o('calibrate', 4, -3.5), o('ignite', 0, -1)],
};

export const AUDIO = {
  vent_code: 'Maintenance duct access code: four, eight, two. I repeat: four, eight, two.',
  pickup: 'Equipment acquired.',
  confirmed: 'System confirmed.',
};

const SPEED = 3.6, CROUCH_SPEED = 1.5, TURN = 1.6, REACH = 2.4, BOUND = 6.4;
const HOLD_MS = 2000;

export class ToySim {
  constructor(seed = 1) {
    this.seed = seed >>> 0;
    this.t = 0;
    this.events = [];
    this.audio = [];
    this.seen = new Set();
    this.state = { room: 'airlock', inventory: [], objective: 'Restore power', oxygen: null, solved: [], softlocked: false };
    this.pos = { x: 0, z: 4 };
    this.yaw = 0;
    this.crouch = false;
    this.mode = 'play';           // play | terminal | settings | log | inventory | dead | won
    this.terminal = null;
    this.code = '';
    this.removed = new Set();
    this.watered = new Set();
    this.lastMove = 0;
    this.lastIdleEmit = 0;
    this.tutorialFired = false;
    this.last = '';
    this.emit({ type: 'room_entered', room: 'airlock' });
  }

  // ── telemetry ─────────────────────────────────────────────────────────────
  emit(e) { const ev = { t: Math.round(this.t), ...e }; this.events.push(ev); return ev; }
  flaw(id) { if (!this.seen.has(id)) { this.seen.add(id); this.emit({ type: 'flaw_triggered', flawId: id }); } }
  say(text) { this.last = text; return text; }
  cue(id) { this.audio.push({ t: Math.round(this.t), id, transcript: AUDIO[id] ?? id }); }
  solved(id) { return this.state.solved.includes(id); }
  solve(id) { if (!this.solved(id)) { this.state.solved.push(id); this.emit({ type: 'puzzle_solved', puzzle: id }); this.cue('confirmed'); } }
  has(item) { return this.state.inventory.includes(item); }
  pick(id) {
    if (this.has(id)) return;
    this.state.inventory.push(id);
    // Only world pickups leave the world. (engine.js removes by bare id, which also hides the
    // reactor's 'regulator' SOCKET once the 'regulator' ITEM is combined — flagged to the game team.)
    if (OBJECTS[this.state.room].some((ob) => ob.id === id && ob.pickup)) this.removed.add(id);
    this.emit({ type: 'item_picked', item: id }); this.cue('pickup'); this.say(`${id.replaceAll('_', ' ')} added to inventory.`);
  }
  use(id) { const i = this.state.inventory.indexOf(id); if (i < 0) return false; this.state.inventory.splice(i, 1); this.emit({ type: 'item_used', item: id }); return true; }
  position() { this.emit({ type: 'position', x: +this.pos.x.toFixed(2), y: this.crouch ? 0.8 : 1.65, z: +this.pos.z.toFixed(2), yaw: +this.yaw.toFixed(3) }); }

  /** Advance the clock. Fires time-based events (tutorial C1, idle, oxygen). */
  advance(ms) {
    const target = this.t + ms;
    while (this.t < target) {
      const step = Math.min(500, target - this.t);
      this.t += step;
      if (!this.tutorialFired && this.t >= 3500) { this.tutorialFired = true; this.flaw('C1'); }
      if (this.state.oxygen !== null && !['dead', 'won', 'settings'].includes(this.mode)) {
        this.state.oxygen = Math.max(0, this.state.oxygen - step / 1000);
        if (this.state.oxygen === 0 && this.mode !== 'dead') { this.mode = 'dead'; this.emit({ type: 'died' }); }
      }
      const idle = this.t - this.lastMove;
      if (idle >= 4000 && this.t - this.lastIdleEmit >= 4000) { this.lastIdleEmit = this.t; this.emit({ type: 'idle', ms: Math.round(idle) }); }
    }
  }

  enter(room) {
    this.state.room = room; this.pos = { x: 0, z: 4 }; this.yaw = 0; this.mode = 'play';
    this.emit({ type: 'room_entered', room });
    if (room === 'power') this.flaw('C4');
    if (room === 'greenhouse') this.flaw('D2');
    if (room === 'reactor') { this.flaw('B4'); this.flaw('U2'); this.state.oxygen = 180; this.state.objective = 'Restart the reactor'; }
    this.position();
  }

  objects() {
    return OBJECTS[this.state.room].filter((ob) => !this.removed.has(ob.id) && (ob.id !== 'bio_cell' || this.watered.size === 12));
  }
  target() {
    let best = null, bd = REACH;
    for (const ob of this.objects()) {
      const d = Math.hypot(ob.x - this.pos.x, ob.z - this.pos.z);
      // the hidden keycard is only reachable when crouched (it is a sliver behind a crate)
      if (ob.hidden && !this.crouch) continue;
      if (d < bd) { bd = d; best = ob; }
    }
    return best;
  }

  // ── actions ───────────────────────────────────────────────────────────────
  /** Apply one runner action `{t, tool, args}`; the clock jumps to `t` first. */
  apply(action) {
    if (typeof action.t === 'number' && action.t > this.t) this.advance(action.t - this.t);
    const args = action.args ?? {};
    switch (action.tool) {
      case 'move': return this.move(args.direction ?? 'forward', Math.min(3000, Number(args.ms) || 500));
      case 'look': return this.look(args.direction ?? 'left', Math.min(3000, Number(args.ms) || 400));
      case 'crouch': this.crouch = !!args.on; this.position(); return this.say(this.crouch ? 'crouching' : 'standing');
      case 'interact': return this.interact(Number(args.hold_ms) || 0);
      case 'use_item': return this.useItem(String(args.name ?? ''));
      case 'open_inventory': this.mode = this.mode === 'inventory' ? 'play' : (this.mode === 'play' ? 'inventory' : this.mode); return this.say(`Inventory: ${this.state.inventory.join(', ') || 'empty'}`);
      case 'type_text': return this.type(String(args.text ?? ''));
      case 'listen': return this.say(JSON.stringify(this.audio));
      default: return this.say('');   // screenshot / note_finding / abandon do not touch the world
    }
  }

  move(direction, ms) {
    if (this.mode !== 'play') return this.say('cannot move right now');
    const f = direction === 'forward' ? 1 : direction === 'back' ? -1 : 0;
    const s = direction === 'right' ? 1 : direction === 'left' ? -1 : 0;
    const speed = this.crouch ? CROUCH_SPEED : SPEED;
    let remaining = ms;
    while (remaining > 0) {
      const slice = Math.min(500, remaining); remaining -= slice;
      const d = speed * slice / 1000;
      const dx = (-Math.sin(this.yaw) * f + Math.cos(this.yaw) * s) * d;
      const dz = (-Math.cos(this.yaw) * f - Math.sin(this.yaw) * s) * d;
      this.pos.x = Math.max(-BOUND, Math.min(BOUND, this.pos.x + dx));
      this.pos.z = Math.max(-BOUND, Math.min(BOUND, this.pos.z + dz));
      this.t += slice; this.lastMove = this.t;
      // B2 — collision hole behind the greenhouse planter: fall out of the world.
      if (this.state.room === 'greenhouse' && this.pos.x > 5.4 && this.pos.z < -5.1 && !this.state.softlocked) {
        this.flaw('B2'); this.state.softlocked = true; this.emit({ type: 'softlock_entered', flawId: 'B2' });
      }
      this.position();
    }
    return this.say('');
  }

  look(direction, ms) {
    const sign = direction === 'left' ? 1 : direction === 'right' ? -1 : 0;
    this.yaw += sign * TURN * ms / 1000;
    this.t += ms;
    this.position();
    return this.say('');
  }

  type(text) {
    if (text === 'Escape') {
      if (this.mode === 'settings') { this.mode = this.prevMode ?? 'play'; this.emit({ type: 'menu_closed' }); return this.say('settings closed'); }
      if (this.mode === 'terminal' && this.code) { this.code = ''; this.flaw('B3'); }   // B3 — settings wipe the typed code
      this.prevMode = this.mode === 'terminal' ? 'terminal' : 'play';
      this.mode = 'settings'; this.emit({ type: 'menu_opened' }); return this.say('settings open');
    }
    if (this.mode !== 'terminal') return this.say('nothing to type into');
    const enter = text.endsWith('\n');
    this.code = (this.code + text.replace(/\D/g, '')).slice(0, 8);
    return enter ? this.submit() : this.say(`entered ${this.code}`);
  }

  submit() {
    const code = this.code; this.code = '';
    if (this.terminal === 'vent_lock' && code === '482') { this.solve('vent_code'); this.mode = 'play'; return this.say('Duct access released.'); }
    if (this.terminal === 'terminal' && code === '7319') {
      if (!this.solved('breaker')) return this.say('Distribution circuit offline. Bridge the circuit first.');
      this.solve('station_power'); this.state.objective = 'Cultivate the botanical reserve'; this.mode = 'play';
      return this.say('Station power restored. Botanical reserve unlocked.');
    }
    if (this.terminal === 'sequence' && code === '321') { this.solve('sequence'); this.mode = 'play'; return this.say('Ignition sequence accepted.'); }
    this.emit({ type: 'puzzle_failed', puzzle: this.terminal });
    return this.say('Authorization rejected.');
  }

  useItem(name) {
    if (this.mode === 'inventory') this.mode = 'play';   // using an item closes the inventory
    if (name === 'combine') {
      if (this.has('wire') && this.has('casing')) { this.use('wire'); this.use('casing'); this.pick('regulator'); this.solve('combine_regulator'); return this.say('Regulator assembled.'); }
      return this.say('Combine requires a copper conductor and regulator housing.');
    }
    const t = this.target();
    if (t && (t.id === 'fuse_socket' || t.id === 'lab_socket') && name === 'fuse') return this.interact(0);
    if (t && t.id === 'regulator' && name === 'regulator') return this.interact(0);
    return this.say(this.has(name) ? `Nothing to use ${name} on here.` : `You do not have ${name}.`);
  }

  interact(holdMs) {
    if (this.mode === 'terminal') { this.mode = 'play'; return this.say('terminal closed'); }
    if (this.mode === 'log' || this.mode === 'inventory') { this.mode = 'play'; return this.say('closed'); }
    if (this.mode !== 'play') return this.say('');
    const ob = this.target();
    if (!ob) return this.say('Nothing here.');
    const id = ob.id;
    if (['early_log', 'lab_log', 'power_log', 'lab_notes', 'grow_log'].includes(id)) { this.mode = 'log'; return this.say(`Reading ${id}.`); }
    if (ob.pickup) { if (id === 'keycard') this.flaw('C3'); this.pick(id); return this.last; }
    if (id === 'airlock_door') { this.enter('corridor'); return this.say('The hatch opens onto the concourse.'); }
    if (id === 'return') { this.enter(this.state.room === 'corridor' ? 'airlock' : 'corridor'); return this.say('Back through the door.'); }
    if (id === 'sealed') { this.flaw('D1'); return this.say('DECOMMISSIONED. This welded bulkhead is permanently sealed.'); }
    if (id === 'speaker') { this.flaw('A1'); this.cue('vent_code'); return this.say('Maintenance recording playing.'); }
    if (id === 'vent_lock' || id === 'terminal' || id === 'sequence') {
      if (id === 'sequence') this.flaw('U1');
      this.terminal = id; this.code = ''; this.mode = 'terminal'; return this.say(`${id} awaits a code.`);
    }
    if (id === 'vent') {
      this.flaw('G1');
      if (!this.crouch) return this.say('The opening is too low.');
      if (!this.solved('vent_code')) return this.say('Duct access is locked.');
      this.solve('vent'); this.enter('power'); return this.say('You crawl through into the power room.');
    }
    if (id === 'power_door' || id === 'lab_door') {
      if (!this.has('keycard')) return this.say('Access denied. Personnel keycard required.');
      if (id === 'power_door' && !this.solved('vent')) return this.say('Door motor offline. Service duct access available.');
      this.emit({ type: 'item_used', item: 'keycard' }); this.enter(id === 'power_door' ? 'power' : 'lab'); return this.say('The door grinds open.');
    }
    if (id === 'greenhouse_door') { if (!this.solved('station_power')) return this.say('Botanical reserve requires station power.'); this.enter('greenhouse'); return this.say('Warm, damp air.'); }
    if (id === 'reactor_door') {
      if (!this.has('bio_cell')) return this.say('Reactor transit requires a bioelectric cell.');
      this.flaw('P2'); this.advance(45_000); this.enter('reactor'); return this.say('Reactor transit complete.');
    }
    if (id === 'lab_socket') {
      if (!this.solved('fuse_socket') && this.use('fuse')) { this.flaw('B1'); this.state.softlocked = true; this.emit({ type: 'softlock_entered', flawId: 'B1' }); return this.say('The fuse seats with a click. Nothing happens.'); }
      return this.say('Auxiliary circuit unavailable.');
    }
    if (id === 'fuse_socket') { if (this.use('fuse')) { this.solve('fuse_socket'); return this.say('Fuse seated. Engage the main breaker.'); } return this.say(this.solved(id) ? 'Fuse seated.' : 'Ceramic fuse required.'); }
    if (id === 'breaker') {
      this.flaw('G2');
      if (!this.solved('fuse_socket')) return this.say('Distribution fuse missing.');
      if (holdMs < HOLD_MS) return this.say('The breaker lever resists.');
      this.t += holdMs; this.solve('breaker'); return this.say('Distribution bridged. Restore power at the lab controller.');
    }
    if (id.startsWith('plant_')) {
      if (this.watered.has(id)) return this.say('Specimen fully irrigated.');
      if (holdMs < HOLD_MS) return this.say('Hold to irrigate.');
      this.t += holdMs; this.watered.add(id);
      if (this.watered.size === 12) { this.flaw('P1'); this.solve('irrigation'); this.state.objective = 'Collect the bioelectric cell'; }
      return this.say(`Specimen irrigated. ${this.watered.size} / 12 complete.`);
    }
    if (id === 'regulator') { if (this.use('regulator')) { this.solve('regulator'); return this.say('Regulator installed.'); } return this.say(this.solved(id) ? 'Regulator online.' : 'Assembled regulator required.'); }
    if (id === 'calibrate') {
      if (this.solved('sequence')) { this.state.solved = this.state.solved.filter((s) => s !== 'sequence'); this.flaw('C2'); this.emit({ type: 'puzzle_failed', puzzle: 'sequence' }); }
      return this.say('Sequence cleared.');
    }
    if (id === 'ignite') {
      if (this.solved('sequence') && this.solved('regulator') && this.use('bio_cell')) { this.solve('reactor'); this.state.oxygen = null; this.state.objective = 'Station Kepler restored'; this.mode = 'won'; return this.say('The core ignites. Station Kepler is restored.'); }
      return this.say('Ignition requires a regulator, a bioelectric cell, and an accepted sequence.');
    }
    return this.say('Nothing happens.');
  }
}

/** Replay a runner action log `[{t, tool, args}]` from scratch. Returns the sim. */
export function replay(log, seed = 1) {
  const sim = new ToySim(seed);
  for (const a of log) sim.apply(a);
  return sim;
}
