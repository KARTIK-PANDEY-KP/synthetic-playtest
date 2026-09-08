import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Game } from '../src/engine.js';
import { normalizeReplay } from '../src/replay.js';
const read = path => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const fixture = read('../public/fixtures/perfect-player.json');
function replay(log) { log = normalizeReplay(log, 186); const g = new Game(log.seed); let i = 0; for (let tick = 1; tick <= log.endTick; tick++) { while (i < log.inputs.length && log.inputs[i].tick === tick) g.input(log.inputs[i++]); g.step(); } assert.equal(i, log.inputs.length); return g; }
const first = replay(fixture), second = replay(fixture);
assert.equal(JSON.stringify(first.events), JSON.stringify(second.events), 'Same seed and input must produce byte-identical events');
assert.equal(JSON.stringify(first.events), JSON.stringify(read('../public/fixtures/perfect-player-events.json')), 'Fixture matches recorded authoring run');
assert.equal(first.mode, 'won');
const ledger = read('../src/flaws/ledger.json');
const triggered = new Set(first.events.filter(e => e.type === 'flaw_triggered').map(e => e.flawId));
for (const entry of ledger.filter(e => e.class !== 'decoy')) assert.ok(triggered.has(entry.id), `Missing flaw ${entry.id}`);
assert.ok(first.events.some(e => e.type === 'died'), 'Oxygen failure exercised');
assert.ok(first.events.some(e => e.type === 'softlock_entered' && e.flawId === 'B1'));
assert.ok(first.events.some(e => e.type === 'softlock_entered' && e.flawId === 'B2'));
const success = replay(read('../public/fixtures/successful-player.json'));
assert.equal(success.mode, 'won', 'Standalone successful path completes');
assert.ok(success.tick / 3600 < 20, 'Intended path completes in less than twenty minutes');
// Decoy interaction is verified independently; no intentional bug is inferred.
const decoy = new Game(); decoy.enter('corridor'); decoy.pos = { x: 4.6, y: 1.65, z: 1 }; decoy.yaw = -Math.PI / 2; decoy.pitch = -.17;
decoy.input({ type: 'keydown', code: 'KeyE' });
assert.ok(decoy.events.some(e => e.type === 'flaw_triggered' && e.flawId === 'D1'));
assert.ok(triggered.has('D2'), 'Atmospheric greenhouse decoy encountered');
// Collision, jump, release, crafting requirements, and hold duration guards.
const movement = new Game(); movement.input({ type: 'keydown', code: 'KeyW' }); for (let i = 0; i < 600; i++) movement.step(); assert.ok(Math.abs(movement.pos.z) < 6.65); movement.input({ type: 'keyup', code: 'KeyW' }); const z = movement.pos.z; movement.step(); assert.equal(movement.pos.z, z);
movement.input({ type: 'keydown', code: 'Space' }); movement.step(); assert.ok(movement.pos.y > 1.65); for (let i = 0; i < 100; i++) movement.step(); assert.equal(movement.pos.y, 1.65);
const hold = new Game(); hold.enter('power'); hold.solve('fuse_socket'); hold.pos = { x: 3, y: 1.65, z: -2.5 }; hold.pitch = Math.atan2(-.4, 2); hold.input({ type: 'keydown', code: 'KeyE' }); for (let i = 0; i < 119; i++) hold.step(); assert.ok(!hold.solved('breaker')); hold.step(); assert.ok(hold.solved('breaker'));
const inventory = new Game(); inventory.input({ type: 'keydown', code: 'KeyI' }); inventory.input({ type: 'keydown', code: 'KeyC' }); assert.ok(!inventory.state.inventory.includes('regulator'));
// Observation is isolated and immutable from the consumer's perspective.
const { installTelemetry } = await import('../src/telemetry.js'); globalThis.window = {}; globalThis.document = { querySelectorAll: () => [] }; installTelemetry(first); const before = first.state.room; const snap = window.__telemetry.snapshot(); snap.room = 'mutated'; snap.inventory.push('fake'); assert.equal(first.state.room, before); assert.ok(!first.state.inventory.includes('fake')); const observed = window.__telemetry.events(); observed[0].type = 'mutated'; assert.notEqual(first.events[0].type, 'mutated'); assert.equal(Object.getOwnPropertyDescriptor(window, '__telemetry').writable, false);
const smoke = new Game(7);
smoke.input({ type: 'keydown', code: 'KeyW' }); for (let i = 0; i < 156; i++) smoke.step(); smoke.input({ type: 'keyup', code: 'KeyW' });
assert.equal(smoke.state.room, 'corridor', 'Smoke: 2600ms walking enters corridor');
smoke.input({ type: 'keydown', code: 'ArrowLeft' }); for (let i = 0; i < 42; i++) smoke.step(); smoke.input({ type: 'keyup', code: 'ArrowLeft' });
smoke.input({ type: 'keydown', code: 'KeyS' }); for (let i = 0; i < 156; i++) smoke.step();
assert.equal(smoke.state.room, 'airlock', 'Smoke: backward movement after turning returns to airlock');
assert.equal(JSON.stringify(replay(read('../public/fixtures/perfect-player-inputs.json')).events), JSON.stringify(first.events), 'Action-log replay matches raw-input replay');
assert.deepEqual(read('./perfect-player.json'), fixture, 'Analysis fixture is at contracted scripts path');
const toolsLog = normalizeReplay([{ t: 0, tool: 'move', args: { direction: 'forward', ms: 500 } }, { t: 500, tool: 'look', args: { direction: 'left', ms: 400 } }, { t: 1000, tool: 'crouch', args: { on: true } }, { t: 1100, tool: 'interact', args: {} }, { t: 1300, tool: 'type_text', args: { text: '482' } }, { t: 1400, tool: 'open_inventory', args: {} }, { t: 1500, tool: 'use_item', args: { name: 'fuse' } }, { t: 1600, tool: 'listen', args: {} }]);
assert.equal(toolsLog.inputs[1].tick, 31); assert.ok(toolsLog.inputs.some(e => e.code === 'ControlLeft')); assert.ok(toolsLog.inputs.some(e => e.key === '8')); assert.throws(() => normalizeReplay([{ t: 0, tool: 'teleport', args: {} }]));
const mainSource = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
const sceneSource = readFileSync(new URL('../src/scene.js', import.meta.url), 'utf8');
const markup = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
assert.ok(![mainSource, sceneSource, markup].some(s => s.includes('__telemetry')), 'No rendering code or markup references observation channel');
assert.deepEqual(read('../public/ledger.json'), ledger, 'Public answer key matches source ledger');
console.log(`PASS: ${first.events.length} byte-identical events across two runs; all 15 flaws + both decoys verified; successful run ${(success.tick / 3600).toFixed(1)} min; controls, collision, hold timing, and observation isolation verified.`);
