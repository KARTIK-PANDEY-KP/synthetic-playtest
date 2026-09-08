import * as THREE from 'three';
import { emit, flaw, installTelemetry } from './telemetry.js';

// ── determinism ─────────────────────────────────────────────────────────────
const params = new URLSearchParams(location.search);
const SEED = Number(params.get('seed') ?? 1);
let _s = SEED >>> 0;
/** Seeded RNG. Never use bare Math.random() — replay verification depends on this. */
const rand = () => (((_s = (_s * 1664525 + 1013904223) >>> 0) / 4294967296));

// ── state ───────────────────────────────────────────────────────────────────
const state = {
  room: 'airlock',
  inventory: [],
  objective: 'Restore station power',
  oxygen: null,
  solved: [],
  softlocked: false,
};
const audioCues = [];
const $ = (id) => document.getElementById(id);

// ── scene ───────────────────────────────────────────────────────────────────
const renderer = new THREE.WebGLRenderer({ canvas: $('view'), antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x05070a, 6, 44);
const camera = new THREE.PerspectiveCamera(72, 1, 0.1, 200);

scene.add(new THREE.AmbientLight(0x93b4d6, 0.75));
const key = new THREE.DirectionalLight(0xffffff, 1.1); key.position.set(6, 14, 8); scene.add(key);

const mat = (c) => new THREE.MeshLambertMaterial({ color: c });
/** Darken per channel. Multiplying a packed 0xRRGGBB int scrambles channels
 *  into an unrelated colour instead of dimming it. */
const dim = (c, k) => (((c >> 16 & 255) * k << 16) | ((c >> 8 & 255) * k << 8) | (c & 255) * k) & 0xffffff;
const box = (w, h, d, c, x, y, z) => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(c));
  m.position.set(x, y, z); scene.add(m); return m;
};

// Airlock (teal) → Corridor (amber). Distinct dominant colour per room so four
// live panes are tellable apart from the back of the room.
const walls = [];
function room(cx, cz, w, d, colour) {
  box(w, 0.2, d, dim(colour, 0.45), cx, -0.1, cz);          // floor
  box(w, 0.2, d, 0x0b1017, cx, 3.4, cz);                 // ceiling
  walls.push(
    box(w, 3.4, 0.3, colour, cx, 1.6, cz - d / 2),
    box(w, 3.4, 0.3, colour, cx, 1.6, cz + d / 2),
    box(0.3, 3.4, d, colour, cx - w / 2, 1.6, cz),
    box(0.3, 3.4, d, colour, cx + w / 2, 1.6, cz),
  );
}
room(0, 0, 12, 12, 0x1f6f74);          // airlock
room(0, -21, 9, 30, 0x8a6524);         // corridor
// doorway between them
scene.remove(walls[1]); walls.splice(1, 1);
box(3.2, 3.4, 0.3, 0x1f6f74, -4.4, 1.6, -6);
box(3.2, 3.4, 0.3, 0x1f6f74, 4.4, 1.6, -6);

// ── interactables ───────────────────────────────────────────────────────────
const interactables = [];
const add = (mesh, def) => { mesh.userData = def; interactables.push(mesh); return mesh; };

// C3 — required keycard is a tiny sliver behind a crate. No highlight, no cue.
box(1.6, 1.6, 1.6, 0x6b7280, 3.0, 0.8, -14);            // the crate
add(box(0.12, 0.06, 0.2, 0xd8c34a, 3.0, 0.06, -14.95), {
  id: 'keycard', label: 'Pick up keycard', flawId: 'C3',
  act() { state.inventory.push('keycard'); emit({ type: 'item_picked', item: 'keycard' }); this.dead = true; },
});

// D1 — DECOY. Meant to stay locked forever. Flagging this is a false positive.
add(box(0.3, 2.6, 2.4, 0x39506b, -4.4, 1.3, -18), {
  id: 'sealed_door', label: 'Sealed bulkhead', flawId: 'D1',
  act() { say('The bulkhead is welded shut. Station schematics mark it decommissioned.'); },
});

// G1 — vent requires crouch (Ctrl), which the game never teaches.
add(box(1.8, 0.9, 0.3, 0x4b5563, 0, 0.45, -35.9), {
  id: 'vent', label: 'Crawl into vent', flawId: 'G1',
  act() {
    if (!crouching) { say('The vent is too low to walk through.'); return; }
    emit({ type: 'puzzle_solved', puzzle: 'vent' }); state.solved.push('vent');
    say('You crawl through into the power room.');
  },
});

// Door to the power room — needs the keycard from C3.
add(box(3.0, 2.8, 0.3, 0xc2703a, 3.0, 1.4, -35.9), {
  id: 'power_door', label: 'Locked door — card reader',
  act() {
    if (!state.inventory.includes('keycard')) { say('A card reader blinks red.'); return; }
    emit({ type: 'puzzle_solved', puzzle: 'power_door' }); state.solved.push('power_door');
    say('The door grinds open.');
  },
});

// ── controls (NO pointer lock — see docs/PLAN-GAME.md) ──────────────────────
const keys = new Set();
// yaw 0 looks down -z in three.js, which is where the corridor doorway is.
// Spawning at PI faced the player into the back wall.
let yaw = 0, pitch = 0, crouching = false, dragging = false;
const pos = new THREE.Vector3(0, 1.6, 3);

addEventListener('keydown', (e) => {
  keys.add(e.code);
  if (e.code === 'KeyE') interact();
  if (e.code.startsWith('Control')) crouching = true;
  if ([...'WASD'].some((c) => e.code === `Key${c}`) || e.code.startsWith('Arrow')) e.preventDefault();
});
addEventListener('keyup', (e) => {
  keys.delete(e.code);
  if (e.code.startsWith('Control')) crouching = false;
});
addEventListener('mousedown', () => { dragging = true; });
addEventListener('mouseup', () => { dragging = false; });
addEventListener('mousemove', (e) => {
  if (!dragging) return;
  yaw -= e.movementX * 0.0032; pitch -= e.movementY * 0.0032;
  pitch = Math.max(-1.3, Math.min(1.3, pitch));
});

// ── interaction ─────────────────────────────────────────────────────────────
const ray = new THREE.Raycaster();
function targeted() {
  ray.setFromCamera(new THREE.Vector2(0, 0), camera);
  const live = interactables.filter((m) => !m.userData.dead);
  const hit = ray.intersectObjects(live, false)[0];
  return hit && hit.distance < 3.2 ? hit.object : null;
}
function interact() {
  const t = targeted();
  if (!t) return;
  if (t.userData.flawId) flaw(t.userData.flawId);
  t.userData.act();
  if (t.userData.dead) scene.remove(t);
}
let sayTimer = 0;
function say(text, ms = 4000) {
  const el = $('prompt'); el.textContent = text; el.classList.remove('hidden');
  sayTimer = performance.now() + ms;
}

// ── C1 — tutorial auto-dismisses after 3.5s and can never be re-read ────────
const tut = $('tutorial');
tut.textContent = 'Station Kepler is losing power. Move with W A S D, drag the mouse to look around, and press E to interact with anything you find.';
tut.classList.remove('hidden');
setTimeout(() => { tut.classList.add('hidden'); flaw('C1'); }, 3500);

// ── loop ────────────────────────────────────────────────────────────────────
let last = performance.now(), lastMove = performance.now(), posTick = 0;
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;

  if (keys.has('ArrowLeft')) yaw += 1.6 * dt;
  if (keys.has('ArrowRight')) yaw -= 1.6 * dt;
  if (keys.has('ArrowUp')) pitch = Math.min(1.3, pitch + 1.2 * dt);
  if (keys.has('ArrowDown')) pitch = Math.max(-1.3, pitch - 1.2 * dt);

  const fwd = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
  const str = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
  if (fwd || str) {
    const sp = (crouching ? 1.5 : 3.6) * dt;
    pos.x -= (Math.sin(yaw) * fwd + Math.cos(yaw) * -str) * sp;
    pos.z -= (Math.cos(yaw) * fwd - Math.sin(yaw) * -str) * sp;
    pos.x = Math.max(-4.2, Math.min(4.2, pos.x));
    pos.z = Math.max(-35.4, Math.min(5.4, pos.z));
    lastMove = now;
  }
  camera.position.set(pos.x, crouching ? 0.95 : 1.6, pos.z);
  camera.rotation.set(pitch, yaw, 0, 'YXZ');

  const nextRoom = pos.z < -6 ? 'corridor' : 'airlock';
  if (nextRoom !== state.room) { state.room = nextRoom; emit({ type: 'room_entered', room: nextRoom }); }

  if (now - lastMove > 4000 && now - posTick > 4000) { emit({ type: 'idle', ms: Math.round(now - lastMove) }); posTick = now; }
  if (now - posTick > 500) {
    posTick = now;
    emit({ type: 'position', x: +pos.x.toFixed(2), y: +camera.position.y.toFixed(2), z: +pos.z.toFixed(2), yaw: +yaw.toFixed(3) });
  }

  const t = targeted();
  const pr = $('prompt');
  if (t && !t.userData.dead) { pr.textContent = `[E] ${t.userData.label}`; pr.classList.remove('hidden'); }
  else if (performance.now() > sayTimer) pr.classList.add('hidden');

  $('objective').textContent = state.objective;
  $('hud').textContent = `ROOM ${state.room.toUpperCase()}`;
  $('inventory').textContent = state.inventory.length ? `CARRYING: ${state.inventory.join(', ')}` : 'CARRYING: nothing';

  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h; camera.updateProjectionMatrix();
}
addEventListener('resize', resize); resize();

installTelemetry(() => ({ ...state, inventory: [...state.inventory], solved: [...state.solved] }), () => audioCues.slice());
emit({ type: 'room_entered', room: 'airlock' });
requestAnimationFrame(frame);
