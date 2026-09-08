import './style.css';
import { Game, HZ } from './engine.js';
import { ROOMS } from './world.js';
import { createScene } from './scene.js';
import { installTelemetry, installReplayStatus } from './telemetry.js';
import { normalizeReplay, toActionLog } from './replay.js';
const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
// Replay logs can be large; Node's HTTP server rejects request lines over 16KB.
// So `#replay=inline:<b64>` (never sent to the server) is accepted as well as `?replay=`.
for (const [k, v] of new URLSearchParams(location.hash.slice(1))) if (!params.has(k)) params.set(k, v);
const game = new Game(Number(params.get('seed') ?? 1));
installTelemetry(game);
let view;
try { view = createScene($('view'), game); } catch (e) { $('load-error').classList.remove('hidden'); $('error-detail').textContent = `WebGL could not start. Enable hardware acceleration and reconnect. ${e.message}`; }
const recording = { version: 1, seed: Number(params.get('seed') ?? 1), hz: HZ, inputs: [], endTick: 0 };
let replay = null, replayIndex = 0, pending = [], dragging = false, audioIndex = 0, audioContext = null, subtitleUntil = 0;
const replayMode = params.has('replay');
const markReplayDone = replayMode ? installReplayStatus(game) : () => {};
// Replays step the simulation as fast as the browser allows unless a human wants to
// watch (?realtime=1). Determinism is per tick, so wall-clock pacing changes nothing.
const fastReplay = replayMode && !params.has('realtime');
const FAST_TICKS_PER_FRAME = 600;
function enqueue(input) { if (!replayMode) pending.push(input); }
function press(code, key = '') { enqueue({ type: 'keydown', code, key }); enqueue({ type: 'keyup', code, key }); }
function unlockAudio() { if (!audioContext) { const Ctx = window.AudioContext || window.webkitAudioContext; if (Ctx) audioContext = new Ctx(); } audioContext?.resume().catch(() => {}); }
addEventListener('keydown', e => { if (['Tab', 'Space', 'Backspace', 'Escape', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code) || e.code.startsWith('Control')) e.preventDefault(); unlockAudio(); enqueue({ type: 'keydown', code: e.code, key: e.key, repeat: e.repeat }); });
addEventListener('keyup', e => enqueue({ type: 'keyup', code: e.code, key: e.key }));
$('view').addEventListener('pointerdown', e => { if (e.button !== 0) return; dragging = true; $('view').setPointerCapture(e.pointerId); unlockAudio(); });
$('view').addEventListener('pointerup', () => dragging = false);
$('view').addEventListener('pointercancel', () => dragging = false);
$('view').addEventListener('pointermove', e => { if (dragging) enqueue({ type: 'look', dx: e.movementX, dy: e.movementY }); });
addEventListener('blur', () => { dragging = false; for (const code of game.keys) enqueue({ type: 'keyup', code }); });
$('settings-button').onclick = () => press('Escape'); $('inventory-button').onclick = () => press('KeyI');
const escapeHtml = text => String(text).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const names = { fuse: 'Ceramic fuse', keycard: 'Personnel keycard', wire: 'Copper conductor', casing: 'Regulator housing', regulator: 'Reactor regulator', bio_cell: 'Bioelectric cell' };
const button = (label, code, primary = false) => `<button data-code="${code}" class="${primary ? 'primary' : ''}">${label}</button>`;
let previousModal = '', previousRoom = '';
function drawUI() {
  const room = ROOMS[game.state.room];
  if (previousRoom !== game.state.room) { previousRoom = game.state.room; $('room-name').textContent = room.name; $('room-subtitle').textContent = room.subtitle; $('sector').textContent = `SECTOR ${room.sector} / 06`; $('sectors').innerHTML = Object.entries(ROOMS).map(([id, r]) => `<div class="sector-step ${id === game.state.room ? 'active' : ''}">${r.sector}<small>${id === game.state.room ? r.name.toUpperCase() : ''}</small></div>`).join(''); }
  $('objective').textContent = game.state.objective;
  $('power-status').textContent = game.solved('station_power') ? 'ONLINE' : 'OFFLINE';
  $('inventory-summary').textContent = game.state.inventory.length ? game.state.inventory.map(id => names[id]).join(' · ') : 'No equipment collected';
  const oxygen = game.state.oxygen;
  $('oxygen-value').textContent = oxygen === null ? 'NOMINAL' : `${Math.ceil(oxygen)}s`;
  $('oxygen-fill').style.width = `${oxygen === null ? 100 : oxygen / 180 * 100}%`;
  $('oxygen-fill').style.background = oxygen !== null && oxygen < 40 ? '#e67b6c' : 'var(--accent)';
  $('tutorial').classList.toggle('hidden', game.tutorialDismissed || !game.tutorialAllowed || game.mode !== 'play');
  const target = game.target();
  $('crosshair').classList.toggle('hidden', game.mode !== 'play' || !!game.liftUntil);
  $('crosshair').classList.toggle('target', !!target && !target.hidden);
  $('prompt').classList.toggle('hidden', !target || target.hidden);
  if (target && !target.hidden) $('prompt').textContent = `[ E ]  ${target.label}${target.kind === 'plant' && !game.watered.includes(target.id) ? ' · hold to water' : ''}`;
  $('message').classList.toggle('hidden', !game.message || game.tick >= game.messageUntil);
  $('message').textContent = game.message;
  // G2 intentionally has no hold indicator; plant irrigation does.
  const showHold = game.hold > 0 && game.holdId.startsWith('plant_');
  $('hold').classList.toggle('hidden', !showHold); if (showHold) $('hold').firstElementChild.style.width = `${game.hold / 200 * 100}%`;
  $('subtitle').classList.toggle('hidden', game.tick >= subtitleUntil || !game.settings.subtitles);
  let html = '';
  if (game.liftUntil && game.mode === 'play') html = `<span class="label">TRANSIT / L–06</span><h2>Descending to the core</h2><p>Please remain in the lift.</p><div class="terminal-screen">TRANSIT IN PROGRESS <span class="caret">▌</span><br>Arrival in ${Math.ceil((game.liftUntil - game.tick) / HZ)} seconds</div>`;
  if (game.mode === 'settings') html = `<span class="label">PERSONAL SYSTEMS</span><h2>Pause & settings</h2><div class="setting-row">Look sensitivity<span>${button('−', 'ArrowLeft')} ${game.settings.sensitivity.toFixed(1)} ${button('+', 'ArrowRight')}</span></div><div class="setting-row">Subtitles ${button(game.settings.subtitles ? 'On' : 'Off', 'KeyT')}</div><div class="setting-row">Audio ${button(game.settings.sound ? 'On' : 'Off', 'KeyM')}</div><div class="actions">${button('Resume · Esc', 'Escape', true)}${button('Load checkpoint', 'KeyC')}${button('Restart station', 'KeyR')}<button id="export-replay">Export input recording</button></div><p class="terminal-hint">I — equipment & crafting<br>Space — jump<br>Progress checkpoints are kept for this session.</p>`;
  if (game.mode === 'log') html = `<span class="label">STATION ARCHIVE</span><h2>${escapeHtml(game.log[0])}</h2><p>${escapeHtml(game.log[1])}</p><div class="actions">${button('Close log · E', 'KeyE', true)}</div>`;
  if (game.mode === 'inventory') html = `<span class="label">PERSONAL EQUIPMENT / ${game.state.inventory.length} ITEMS</span><h2>What you carry</h2><div class="items">${game.state.inventory.map(id => `<div class="item">${names[id]}<small>${id === 'keycard' ? 'Access credential' : 'Station equipment'}</small></div>`).join('') || '<p>Your equipment slots are empty.</p>'}</div><p>Select an object in the station and press E to use compatible equipment. Combine a copper conductor and regulator housing to assemble a reactor regulator.</p><div class="actions">${button('Combine components · C', 'KeyC', true)}${button('Return · I', 'KeyI')}</div>`;
  if (game.mode === 'terminal') {
    const title = game.terminal === 'vent_lock' ? 'Duct access' : game.terminal === 'sequence' ? 'Core ignition' : 'Station controller';
    html = `<span class="label">KEPLER SYSTEMS / SECURE CONSOLE</span><h2>${title}</h2><div class="terminal-screen">${game.terminal === 'sequence' ? 'ENTER THREE-DIGIT START ORDER' : 'ENTER AUTHORIZATION CODE'}<div class="terminal-entry" aria-label="Entered code">${escapeHtml(game.code)}<span class="caret">▌</span></div></div><p class="terminal-hint">Type using your keyboard. Enter to submit.<br>Backspace to delete. Esc opens settings.</p><div class="actions">${button('Submit · Enter', 'Enter', true)}${button('Leave terminal · Tab', 'Tab')}</div>`;
  }
  if (game.mode === 'won') html = `<div class="win-symbol">✳</div><span class="label">SIGNAL REESTABLISHED</span><h2>There is still light.</h2><p>Power flows through Station Kepler again. The reserve is breathing. Somewhere beyond the glass, a signal answers yours.</p><div class="terminal-screen">STATION STATUS: RESTORED<br>MISSION COMPLETE</div><div class="actions">${button('Begin again', 'KeyR', true)}</div>`;
  if (game.mode === 'dead') html = `<span class="label">SUIT TELEMETRY / SIGNAL LOST</span><h2>Oxygen depleted.</h2><p>The station falls silent. Your expedition has ended.</p><div class="actions">${button('Restart expedition', 'KeyR', true)}</div>`;
  $('modal').classList.toggle('hidden', !html);
  if (html !== previousModal) { previousModal = html; $('modal-card').innerHTML = html; $('modal-card').dataset.textKind = game.mode === 'log' ? 'log' : 'menu'; for (const b of $('modal-card').querySelectorAll('[data-code]')) b.onclick = () => press(b.dataset.code); const exportButton = $('export-replay'); if (exportButton) exportButton.onclick = () => { recording.endTick = game.tick; const a = document.createElement('a'); const url = URL.createObjectURL(new Blob([JSON.stringify(toActionLog(recording))], { type: 'application/json' })); a.href = url; a.download = `kepler-${recording.seed}-inputs.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }; }
}
function playAudio() {
  while (audioIndex < game.audio.length) {
    const cue = game.audio[audioIndex++];
    // A1 is intentional: the duct code is never rendered, even with subtitles on.
    if (cue.id !== 'vent_code' && game.settings.subtitles) { $('subtitle').textContent = cue.transcript; subtitleUntil = game.tick + 150; }
    if (!game.settings.sound) continue;
    if (cue.id === 'vent_code' && 'speechSynthesis' in window) { const speech = new SpeechSynthesisUtterance(cue.transcript); speech.rate = .88; speechSynthesis.speak(speech); }
    else if (audioContext?.state === 'running') { const osc = audioContext.createOscillator(), gain = audioContext.createGain(); osc.type = 'sine'; osc.frequency.setValueAtTime(cue.id === 'pickup' ? 620 : 390, audioContext.currentTime); gain.gain.setValueAtTime(.04, audioContext.currentTime); gain.gain.exponentialRampToValueAtTime(.001, audioContext.currentTime + .18); osc.connect(gain).connect(audioContext.destination); osc.start(); osc.stop(audioContext.currentTime + .2); }
  }
}
async function boot() {
  if (!view) return;
  if (replayMode) {
    // Contract (docs/INTERFACES.md): ?replay=<url> OR ?replay=inline:<base64 json>.
    // The verifier embeds action logs inline so it needs no file host. Accepts base64 or
    // base64url; URLSearchParams turns '+' into ' ', so that is reversed too.
    try { const src = params.get('replay'); const raw = src.startsWith('inline:') ? JSON.parse(atob(src.slice(7).replace(/-/g, '+').replace(/_/g, '/').replace(/ /g, '+'))) : await (async () => { const response = await fetch(src); if (!response.ok) throw new Error(`HTTP ${response.status}`); return response.json(); })(); replay = normalizeReplay(raw, Number(params.get('seed') ?? 1)); if (!params.has('seed')) game.initializeSeed(replay.seed); }
    catch (e) { $('load-error').classList.remove('hidden'); $('error-detail').textContent = `Unable to load replay: ${e.message}`; return; }
  }
  let last = performance.now(), accumulator = 0;
  function frame(now) {
    accumulator += Math.min((now - last) / 1000, .25); last = now;
    if (fastReplay) accumulator = FAST_TICKS_PER_FRAME / HZ;
    while (accumulator >= 1 / HZ) {
      const nextTick = game.tick + 1;
      if (replay && nextTick > replay.endTick) { accumulator = 0; markReplayDone(); break; }
      if (replay) { while (replayIndex < replay.inputs.length && replay.inputs[replayIndex].tick === nextTick) game.input(replay.inputs[replayIndex++]); }
      else { for (const e of pending) { recording.inputs.push({ tick: nextTick, ...e }); game.input(e); } pending = []; }
      game.step(); accumulator -= 1 / HZ;
    }
    drawUI(); playAudio(); view.render(); requestAnimationFrame(frame);
  }
  drawUI(); view.render(); requestAnimationFrame(frame);
}
boot();
