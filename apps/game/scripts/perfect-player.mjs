/** Authoring-side fixture generator. Produces only keyboard and mouse-delta inputs;
 * the shipped game exposes no action, navigation, or puzzle API. */
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Game, HZ } from '../src/engine.js';
import { toActionLog } from '../src/replay.js';
import { OBJECTS } from '../src/world.js';
const game = new Game(186);
const inputs = [];
function input(event) { inputs.push({ tick: game.tick + 1, ...event }); game.input(event); }
function wait(n = 1) { for (let i = 0; i < n; i++) game.step(); }
function down(code, key = '') { input({ type: 'keydown', code, key }); }
function up(code) { input({ type: 'keyup', code }); }
function tap(code, key = '') { down(code, key); up(code); wait(); }
function look(yaw, pitch = 0) { input({ type: 'look', dx: (game.yaw - yaw) / .0032, dy: (game.pitch - pitch) / .0032 }); wait(); }
function straight(x, z) {
  const distance = Math.hypot(x - game.pos.x, z - game.pos.z);
  if (distance < .045) return;
  look(Math.atan2(game.pos.x - x, game.pos.z - z)); down('KeyW'); wait(Math.max(1, Math.round(distance / (3.6 / HZ)))); up('KeyW'); wait();
}
function clear(ax, az, bx, bz) {
  const steps = Math.ceil(Math.hypot(bx - ax, bz - az) / .025);
  for (let i = 0; i <= steps; i++) if (!game.canStand(ax + (bx - ax) * i / (steps || 1), az + (bz - az) * i / (steps || 1))) return false;
  return true;
}
function go(x, z) {
  if (clear(game.pos.x, game.pos.z, x, z)) { straight(x, z); return; }
  const size = .25, key = (x, z) => `${x},${z}`;
  const sx = Math.round(game.pos.x / size), sz = Math.round(game.pos.z / size);
  const queue = [[sx, sz]], parents = new Map([[key(sx, sz), null]]); let found;
  for (let index = 0; index < queue.length; index++) {
    const [gx, gz] = queue[index];
    if (Math.hypot(gx * size - x, gz * size - z) < .4 && clear(gx * size, gz * size, x, z)) { found = [gx, gz]; break; }
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = gx + dx, nz = gz + dz, k = key(nx, nz);
      if (parents.has(k) || !game.canStand(nx * size, nz * size) || (game.state.room === 'greenhouse' && nx * size > 5.3 && nz * size < -5)) continue;
      parents.set(k, [gx, gz]); queue.push([nx, nz]);
    }
  }
  assert.ok(found, `No route to ${x}, ${z} in ${game.state.room}`);
  const path = [[x, z]];
  for (let n = found; n; n = parents.get(key(...n))) path.unshift(n.map(v => v * size));
  while (path.length) {
    let next = path.length - 1;
    while (next > 0 && !clear(game.pos.x, game.pos.z, ...path[next])) next--;
    straight(...path[next]); path.splice(0, next + 1);
  }
  assert.ok(Math.hypot(x - game.pos.x, z - game.pos.z) < .12, `Navigation blocked in ${game.state.room}`);
}
function aim(id) { const o = OBJECTS[game.state.room].find(o => o.id === id); assert.ok(o, id); const dx = o.x - game.pos.x, dz = o.z - game.pos.z; look(Math.atan2(-dx, -dz), Math.atan2(o.y - game.pos.y, Math.hypot(dx, dz))); assert.equal(game.target()?.id, id, `Cannot target ${id} in ${game.state.room} from ${JSON.stringify(game.pos)}`); }
function use(id, x, z, hold = 0) { if (x !== undefined) go(x, z); aim(id); if (hold) { down('KeyE'); wait(hold); up('KeyE'); wait(); } else tap('KeyE'); }
function type(value) { for (const key of value) tap(`Digit${key}`, key); tap('Enter'); }
function back() { go(0, 4.2); use('return'); }
function restart() { if (game.mode !== 'dead') tap('Escape'); tap('KeyR'); }
function arrival() { wait(211); use('early_log', -4.5, -2); tap('KeyE'); go(0, -1); use('fuse', 4, -1); go(0, -2); use('airlock_door', 0, -4.5); }
function card() { go(0, .2); use('keycard', 3.3, .65); }
function labDoor() { go(0, 0); use('lab_door', -1.7, -4.5); }
function power() {
  use('speaker', -5, -1); use('vent_lock', -4.3, 3.3); type('482');
  use('vent', -4.3, 1); down('ControlLeft'); wait(); aim('vent'); tap('KeyE'); up('ControlLeft'); wait();
  assert.equal(game.state.room, 'power');
  go(-3, 2); use('fuse_socket', -3, -2.5); go(3, -2.5); use('breaker', undefined, undefined, 121); assert.ok(game.solved('breaker'));
  use('wire', 4, 2); go(3, 4); back();
}
function lab() {
  labDoor(); use('terminal', 0, -2.4); tap('Digit7', '7'); tap('Escape'); assert.equal(game.code, ''); tap('Escape'); type('7319'); assert.ok(game.solved('station_power'));
  use('casing', 4, -1); go(0, -1); back(); tap('KeyI'); tap('KeyC'); tap('KeyI'); assert.ok(game.state.inventory.includes('regulator'));
}
function plants() {
  use('greenhouse_door', 1.7, -4.5);
  for (let i = 0; i < 12; i++) { const o = OBJECTS.greenhouse.find(o => o.id === `plant_${i}`); go(o.x, o.z + 1.8); use(o.id, undefined, undefined, 201); }
  assert.equal(game.watered.length, 12); use('bio_cell', 4.1, 4.5); back();
}
function reactor() { go(0, 0); use('reactor_door', 5, -4.5); wait(2701); assert.equal(game.state.room, 'reactor'); }
// Destructive branch 1: consume the only fuse, then explicitly restart.
arrival(); card(); labDoor(); use('lab_socket', -4, -2.5); assert.ok(game.state.softlocked); restart();
// Destructive branch 2: reach the unsupported planter floor; no auto respawn.
arrival(); card(); power(); lab(); plants(); use('greenhouse_door', 1.7, -4.5); go(5.9, 0); go(5.9, -5.05); look(0); down('KeyW'); wait(20); up('KeyW'); wait(90); assert.ok(game.falling); restart();
// Destructive branch 3: oxygen death requires a full restart.
arrival(); card(); power(); lab(); plants(); reactor(); wait(180 * HZ + 1); assert.equal(game.mode, 'dead'); restart();
// Successful final expedition, including confusing calibration reset.
arrival(); card(); power(); lab(); plants(); reactor();
use('regulator', -4, -1.5); use('sequence', 0, -2.8); type('321'); use('calibrate', 4, -1.5); assert.ok(!game.solved('sequence')); use('sequence', 0, -2.8); type('321'); use('ignite', 0, .9); assert.equal(game.mode, 'won');
const fixture = { version: 1, seed: 186, hz: HZ, inputs, endTick: game.tick };
const out = fileURLToPath(new URL('../public/fixtures/', import.meta.url)); mkdirSync(out, { recursive: true });
writeFileSync(`${out}perfect-player.json`, JSON.stringify(toActionLog(fixture)));
writeFileSync(new URL('./perfect-player.json', import.meta.url), JSON.stringify(toActionLog(fixture)));
writeFileSync(`${out}perfect-player-inputs.json`, JSON.stringify(fixture));
writeFileSync(`${out}perfect-player-events.json`, JSON.stringify(game.events));
// Standalone successful path starts at the last restart and uses fresh seed/state.
const lastRestart = inputs.findLastIndex(e => e.type === 'keydown' && e.code === 'KeyR');
const startTick = inputs[lastRestart].tick;
const success = { ...fixture, inputs: inputs.slice(lastRestart + 2).map(e => ({ ...e, tick: e.tick - startTick + 1 })), endTick: game.tick - startTick + 1 };
// C1 fires on fresh boot, unlike the restarted session; the successful fixture is
// replayed independently below, not compared against the multi-attempt suffix.
writeFileSync(`${out}successful-player.json`, JSON.stringify(toActionLog(success)));
writeFileSync(`${out}successful-player-inputs.json`, JSON.stringify(success));
console.log(`Generated ${inputs.length} real-input events over ${(game.tick / HZ / 60).toFixed(1)} minutes, with three deliberate restarts.`);
console.log(`Successful expedition: ${(success.endTick / HZ / 60).toFixed(1)} minutes.`);
