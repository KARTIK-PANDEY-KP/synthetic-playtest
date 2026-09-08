import { OBJECTS, OBSTACLES, LOGS } from './world.js';
export const HZ = 60;
export class Game {
  constructor(seed = 1, emit = () => {}) {
    this.seed = seed >>> 0; this.emitCallback = emit; this.tick = 0; this.events = []; this.audio = []; this.keys = new Set(); this.seen = new Set(); this.settings = { sensitivity: 1, subtitles: true, sound: true }; this.reset();
  }
  random() { this.seed = (this.seed * 1664525 + 1013904223) >>> 0; return this.seed / 4294967296; }
  event(type, data = {}) { const e = { t: Math.round(this.tick * 1000 / HZ), type, ...data }; this.events.push(e); this.emitCallback(e); }
  flaw(id) { if (!this.seen.has(id)) { this.seen.add(id); this.event('flaw_triggered', { flawId: id }); } }
  reset() {
    this.state = { room: 'airlock', inventory: [], objective: 'Restore power', oxygen: null, solved: [], softlocked: false };
    this.pos = { x: 0, y: 1.65, z: 4 }; this.yaw = 0; this.pitch = 0; this.vy = 0; this.jump = 0;
    this.mode = 'play'; this.previousMode = 'play'; this.code = ''; this.terminal = ''; this.message = ''; this.messageUntil = 0; this.tutorialUntil = this.tick + 210; this.tutorialDismissed = false; this.tutorialAllowed = !this.everStarted; this.everStarted = true;
    this.watered = []; this.removed = new Set(); this.hold = 0; this.holdId = ''; this.lastActivity = this.tick; this.falling = false; this.liftUntil = 0; this.selected = []; this.seen.clear(); this.keys.clear(); this.event('room_entered', { room: 'airlock' }); this.saveCheckpoint();
  }
  get crouching() { return this.keys.has('ControlLeft') || this.keys.has('ControlRight'); }
  solved(id) { return this.state.solved.includes(id); }
  solve(id) { if (!this.solved(id)) { this.state.solved.push(id); this.event('puzzle_solved', { puzzle: id }); this.cue('confirmed', 'System confirmed.'); } }
  say(message, seconds = 5) { this.message = message; this.messageUntil = this.tick + seconds * HZ; }
  cue(id, transcript) { this.audio.push({ t: Math.round(this.tick * 1000 / HZ), id, transcript }); }
  pick(id) { if (this.state.inventory.includes(id)) return; this.state.inventory.push(id); this.removed.add(id); this.event('item_picked', { item: id }); this.cue('pickup', 'Equipment acquired.'); this.say(`${id.replaceAll('_', ' ')} added to inventory.`); }
  use(id) { const i = this.state.inventory.indexOf(id); if (i < 0) return false; this.state.inventory.splice(i, 1); this.event('item_used', { item: id }); return true; }
  saveCheckpoint() { this.checkpoint = JSON.parse(JSON.stringify({ state: this.state, removed: [...this.removed], watered: this.watered })); }
  restore() { if (this.mode === 'dead') return; const c = this.checkpoint; this.state = structuredClone(c.state); this.removed = new Set(c.removed); this.watered = [...c.watered]; this.pos = { x: 0, y: 1.65, z: 4 }; this.jump = 0; this.vy = 0; this.falling = false; this.yaw = 0; this.pitch = 0; this.mode = 'play'; this.keys.clear(); this.event('respawned'); this.say('Checkpoint restored.'); }
  enter(room) {
    this.state.room = room; this.pos = { x: 0, y: 1.65, z: 4 }; this.yaw = 0; this.pitch = 0; this.keys.clear(); this.event('room_entered', { room });
    if (room === 'power') this.flaw('C4');
    if (room === 'greenhouse') this.flaw('D2');
    if (room === 'reactor') { this.flaw('B4'); this.flaw('U2'); this.state.oxygen = 180; this.state.objective = 'Restart the reactor'; }
    this.saveCheckpoint();
  }
  objects() { return OBJECTS[this.state.room].filter(o => !this.removed.has(o.id) && (o.id !== 'bio_cell' || this.watered.length === 12)); }
  target() {
    if (this.mode !== 'play' || this.falling || this.liftUntil) return null;
    const dir = { x: -Math.sin(this.yaw) * Math.cos(this.pitch), y: Math.sin(this.pitch), z: -Math.cos(this.yaw) * Math.cos(this.pitch) };
    const intersect = o => {
      let near = 0, far = 3.2;
      for (const [axis, size] of [['x', 'w'], ['y', 'h'], ['z', 'd']]) {
        const lo = o[axis] - o[size] / 2, hi = o[axis] + o[size] / 2;
        if (Math.abs(dir[axis]) < 1e-8) { if (this.pos[axis] < lo || this.pos[axis] > hi) return null; }
        else { const a = (lo - this.pos[axis]) / dir[axis], b = (hi - this.pos[axis]) / dir[axis]; near = Math.max(near, Math.min(a, b)); far = Math.min(far, Math.max(a, b)); if (near > far) return null; }
      }
      return near;
    };
    let closest = 3.2, target = null;
    for (const o of this.objects()) { const d = intersect(o); if (d !== null && d < closest) { closest = d; target = o; } }
    for (const o of OBSTACLES[this.state.room] || []) { const d = intersect({ ...o, y: o.h / 2 }); if (d !== null && d < closest) target = null; }
    return target;
  }
  input(e) {
    if (e.type === 'look') { if (this.mode === 'play') { this.yaw -= e.dx * .0032 * this.settings.sensitivity; this.pitch = Math.max(-1.35, Math.min(1.35, this.pitch - e.dy * .0032 * this.settings.sensitivity)); } return; }
    if (e.type === 'keyup') { this.keys.delete(e.code); return; }
    if (e.type !== 'keydown' || e.repeat) return;
    this.lastActivity = this.tick;
    if (e.code === 'Escape') {
      this.keys.clear();
      if (this.mode === 'settings') { this.mode = this.previousMode; this.event('menu_closed'); }
      else if (this.mode === 'log' || this.mode === 'inventory') this.mode = 'play';
      else if (!['dead', 'won'].includes(this.mode)) { this.previousMode = this.mode; if (this.mode === 'terminal' && this.code) { this.code = ''; this.flaw('B3'); } this.mode = 'settings'; this.event('menu_opened'); }
      return;
    }
    if (e.code === 'KeyR' && ['settings', 'dead', 'won'].includes(this.mode)) { this.reset(); return; }
    if (this.mode === 'settings') {
      if (e.code === 'KeyC') this.restore();
      if (e.code === 'KeyM') this.settings.sound = !this.settings.sound;
      if (e.code === 'KeyT') this.settings.subtitles = !this.settings.subtitles;
      if (e.code === 'ArrowLeft') this.settings.sensitivity = Math.max(.4, +(this.settings.sensitivity - .1).toFixed(1));
      if (e.code === 'ArrowRight') this.settings.sensitivity = Math.min(2, +(this.settings.sensitivity + .1).toFixed(1));
      return;
    }
    if (this.mode === 'terminal') {
      if (e.code === 'Tab') { this.mode = 'play'; return; }
      if (e.code === 'Backspace') this.code = this.code.slice(0, -1);
      if (/^[0-9]$/.test(e.key || '')) this.code = (this.code + e.key).slice(0, 8);
      if (e.code === 'Enter') this.submit();
      return;
    }
    if (e.code === 'KeyI' && ['play', 'inventory'].includes(this.mode)) { this.mode = this.mode === 'play' ? 'inventory' : 'play'; this.keys.clear(); return; }
    if (this.mode === 'inventory') {
      if (e.code === 'KeyC') { if (this.state.inventory.includes('wire') && this.state.inventory.includes('casing')) { this.use('wire'); this.use('casing'); this.pick('regulator'); this.solve('combine_regulator'); } else this.say('Combine requires a copper conductor and regulator housing.'); }
      return;
    }
    if (this.mode === 'log') { if (e.code === 'KeyE' || e.code === 'Enter') this.mode = 'play'; return; }
    if (this.mode !== 'play' || this.falling || this.liftUntil) return;
    this.keys.add(e.code);
    if (e.code === 'Space' && this.jump === 0 && !this.crouching) this.vy = 4.5;
    if (e.code === 'KeyE') { const o = this.target(); if (o) this.interact(o); }
  }
  openTerminal(id) { this.terminal = id; this.code = ''; this.mode = 'terminal'; this.keys.clear(); }
  submit() {
    if (this.terminal === 'vent_lock' && this.code === '482') { this.solve('vent_code'); this.mode = 'play'; this.say('Duct access released.'); }
    else if (this.terminal === 'terminal' && this.code === '7319') {
      if (!this.solved('breaker')) { this.say('Distribution circuit offline. Bridge the circuit first.'); return; }
      this.solve('station_power'); this.state.objective = 'Cultivate the botanical reserve'; this.mode = 'play'; this.say('Station power restored. Botanical reserve unlocked.'); this.saveCheckpoint();
    } else if (this.terminal === 'sequence' && this.code === '321') { this.solve('sequence'); this.mode = 'play'; this.say('Ignition sequence accepted.'); }
    else { this.event('puzzle_failed', { puzzle: this.terminal }); this.say('Authorization rejected.'); this.code = ''; }
  }
  interact(o) {
    const id = o.id;
    if (LOGS[id]) { this.log = LOGS[id]; this.mode = 'log'; this.keys.clear(); return; }
    if (['fuse', 'wire', 'casing', 'keycard', 'bio_cell'].includes(id)) { if (id === 'keycard') this.flaw('C3'); this.pick(id); return; }
    if (id === 'return') { this.enter(this.state.room === 'corridor' ? 'airlock' : 'corridor'); return; }
    if (id === 'airlock_door') { this.enter('corridor'); return; }
    if (id === 'sealed') { this.flaw('D1'); this.say('DECOMMISSIONED. This welded bulkhead is permanently sealed.'); return; }
    if (id === 'speaker') { this.flaw('A1'); this.cue('vent_code', 'Maintenance duct access code: four, eight, two. I repeat: four, eight, two.'); this.say('Maintenance recording playing.'); return; }
    if (id === 'vent_lock') { this.openTerminal(id); return; }
    if (id === 'vent') {
      this.flaw('G1');
      if (!this.crouching) { this.say('The opening is too low.'); return; }
      if (!this.solved('vent_code')) { this.say('Duct access is locked.'); return; }
      this.solve('vent'); this.enter('power'); return;
    }
    if (id === 'power_door' || id === 'lab_door') {
      if (!this.state.inventory.includes('keycard')) { this.say('Access denied. Personnel keycard required.'); return; }
      if (id === 'power_door' && !this.solved('vent')) { this.say('Door motor offline. Service duct access available.'); return; }
      this.event('item_used', { item: 'keycard' }); this.enter(id === 'power_door' ? 'power' : 'lab'); return;
    }
    if (id === 'greenhouse_door') { if (!this.solved('station_power')) this.say('Botanical reserve requires station power.'); else this.enter('greenhouse'); return; }
    if (id === 'reactor_door') {
      if (!this.state.inventory.includes('bio_cell')) { this.say('Reactor transit requires a bioelectric cell.'); return; }
      this.flaw('P2'); this.liftUntil = this.tick + 45 * HZ; this.keys.clear(); this.say('Reactor transit in progress.', 45); return;
    }
    if (id === 'lab_socket') { if (!this.solved('fuse_socket') && this.use('fuse')) { this.flaw('B1'); this.state.softlocked = true; this.event('softlock_entered', { flawId: 'B1' }); } else this.say('Auxiliary circuit unavailable.'); return; }
    if (id === 'fuse_socket') { if (this.use('fuse')) { this.solve('fuse_socket'); this.say('Fuse seated. Engage the main breaker.'); } else this.say(this.solved(id) ? 'Fuse seated.' : 'Ceramic fuse required.'); return; }
    if (id === 'breaker') { this.flaw('G2'); if (!this.solved('fuse_socket')) this.say('Distribution fuse missing.'); return; }
    if (id === 'terminal') { this.openTerminal(id); return; }
    if (id.startsWith('plant_')) { if (this.watered.includes(id)) this.say('Specimen fully irrigated.'); return; }
    if (id === 'regulator') { if (this.use('regulator')) { this.solve('regulator'); this.say('Regulator installed.'); } else this.say(this.solved(id) ? 'Regulator online.' : 'Assembled regulator required.'); return; }
    if (id === 'sequence') { this.flaw('U1'); this.openTerminal(id); return; }
    if (id === 'calibrate') { if (this.solved('sequence')) { this.state.solved = this.state.solved.filter(s => s !== 'sequence'); this.flaw('C2'); this.event('puzzle_failed', { puzzle: 'sequence' }); this.say('Sequence cleared.'); } else this.say('Sequence cleared.'); return; }
    if (id === 'ignite') { if (this.solved('sequence') && this.solved('regulator') && this.use('bio_cell')) { this.solve('reactor'); this.state.oxygen = null; this.state.objective = 'Station Kepler restored'; this.mode = 'won'; this.keys.clear(); } else this.say('Ignition requires a regulator, a bioelectric cell, and an accepted sequence.'); }
  }
  step() {
    this.tick++;
    if (!this.tutorialDismissed && this.tick >= this.tutorialUntil) { this.tutorialDismissed = true; if (this.tutorialAllowed) this.flaw('C1'); }
    if (this.mode === 'play' && this.liftUntil && this.tick >= this.liftUntil) { this.liftUntil = 0; this.enter('reactor'); }
    if (this.state.oxygen !== null && !['dead', 'won', 'settings'].includes(this.mode)) { this.state.oxygen = Math.max(0, this.state.oxygen - 1 / HZ); if (this.state.oxygen === 0) { this.mode = 'dead'; this.keys.clear(); this.event('died'); } }
    if (this.mode === 'play' && !this.liftUntil) {
      if (this.keys.has('ArrowLeft')) this.yaw += 1.6 / HZ;
      if (this.keys.has('ArrowRight')) this.yaw -= 1.6 / HZ;
      if (this.keys.has('ArrowUp')) this.pitch = Math.min(1.35, this.pitch + 1.2 / HZ);
      if (this.keys.has('ArrowDown')) this.pitch = Math.max(-1.35, this.pitch - 1.2 / HZ);
      const f = Number(this.keys.has('KeyW')) - Number(this.keys.has('KeyS')), s = Number(this.keys.has('KeyD')) - Number(this.keys.has('KeyA'));
      if (!this.falling) {
        const speed = (this.crouching ? 1.5 : 3.6) / HZ / (Math.hypot(f, s) || 1);
        const dx = (-Math.sin(this.yaw) * f + Math.cos(this.yaw) * s) * speed, dz = (-Math.cos(this.yaw) * f - Math.sin(this.yaw) * s) * speed;
        const can = (x, z) => Math.abs(x) < 6.65 && Math.abs(z) < 6.65 && !(OBSTACLES[this.state.room] || []).some(o => this.jump < o.h && Math.abs(x - o.x) < o.w / 2 + .25 && Math.abs(z - o.z) < o.d / 2 + .25);
        if (can(this.pos.x + dx, this.pos.z)) this.pos.x += dx;
        if (can(this.pos.x, this.pos.z + dz)) this.pos.z += dz;
        if (f || s) this.lastActivity = this.tick;
        if (this.vy || this.jump) { this.vy -= 9.8 / HZ; this.jump = Math.max(0, this.jump + this.vy / HZ); if (!this.jump) this.vy = 0; }
        this.pos.y = (this.crouching ? .8 : 1.65) + this.jump;
        if (this.state.room === 'greenhouse' && this.pos.x > 5.4 && this.pos.z < -5.1) { this.falling = true; this.flaw('B2'); this.state.softlocked = true; this.event('softlock_entered', { flawId: 'B2' }); }
      } else this.pos.y -= .18;
      const t = this.target();
      const holdable = t && (t.id === 'breaker' && this.solved('fuse_socket') && !this.solved('breaker') || t.id.startsWith('plant_') && !this.watered.includes(t.id));
      if (this.keys.has('KeyE') && holdable) {
        if (this.holdId !== t.id) { this.holdId = t.id; this.hold = 0; } this.hold++;
        const duration = t.id === 'breaker' ? 120 : 200;
        if (this.hold >= duration) { if (t.id === 'breaker') { this.solve('breaker'); this.say('Distribution bridged. Restore power at the lab controller.'); } else { this.watered.push(t.id); if (this.watered.length === 12) { this.flaw('P1'); this.solve('irrigation'); this.state.objective = 'Collect the bioelectric cell'; } this.say(`Specimen irrigated. ${this.watered.length} / 12 complete.`); } this.hold = 0; }
      } else { this.hold = 0; this.holdId = ''; }
    }
    if (this.tick % 30 === 0) this.event('position', { x: +this.pos.x.toFixed(3), y: +this.pos.y.toFixed(3), z: +this.pos.z.toFixed(3), yaw: +this.yaw.toFixed(4) });
    if ((this.tick - this.lastActivity) >= 240 && this.tick % 240 === 0) this.event('idle', { ms: Math.round((this.tick - this.lastActivity) * 1000 / HZ) });
  }
}
