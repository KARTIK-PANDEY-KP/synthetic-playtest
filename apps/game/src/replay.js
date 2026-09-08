import { HZ } from './engine.js';
const tickAt = t => Math.round(t * HZ / 1000) + 1;
const movement = { forward: 'KeyW', back: 'KeyS', left: 'KeyA', right: 'KeyD' };
const looking = { left: 'ArrowLeft', right: 'ArrowRight', up: 'ArrowUp', down: 'ArrowDown' };
/** Action timestamps are milliseconds from simulation start, at action START.
 * Compilation only creates input events; it never calls game actions. */
export function normalizeReplay(log, seed = 1) {
  if (!Array.isArray(log)) {
    if (log?.version !== 1 || log.hz !== HZ || !Number.isInteger(log.endTick) || log.endTick < 0 || !Array.isArray(log.inputs)) throw new Error('Invalid input recording');
    for (let i = 0; i < log.inputs.length; i++) { const e = log.inputs[i]; if (!Number.isInteger(e.tick) || e.tick < 1 || e.tick > log.endTick || (i && e.tick < log.inputs[i - 1].tick)) throw new Error('Invalid input timing'); validateInput(e); }
    return log;
  }
  const inputs = []; let endTick = 0;
  const push = (tick, event) => { validateInput(event); inputs.push({ tick, ...event }); endTick = Math.max(endTick, tick); };
  const key = (tick, code, down, value = '') => push(tick, { type: down ? 'keydown' : 'keyup', code, key: value });
  const press = (tick, code, value = '') => { key(tick, code, true, value); key(tick, code, false, value); };
  for (const action of log) {
    if (!Number.isFinite(action.t) || action.t < 0 || typeof action.tool !== 'string') throw new Error('Invalid action record');
    const tick = tickAt(action.t), args = action.args ?? {}; endTick = Math.max(endTick, tick);
    switch (action.tool) {
      case 'move': case 'look': {
        if (action.tool === 'look' && Number.isFinite(args.dx) && Number.isFinite(args.dy)) { push(tick, { type: 'look', dx: args.dx, dy: args.dy }); break; }
        const code = (action.tool === 'move' ? movement : looking)[args.direction];
        const ms = args.ms ?? (action.tool === 'move' ? 500 : 400);
        if (!code || !Number.isFinite(ms) || ms < 0) throw new Error(`Invalid ${action.tool} action`);
        key(tick, code, true); key(tick + Math.round(Math.min(3000, ms) * HZ / 1000), code, false); break;
      }
      case 'crouch': key(tick, 'ControlLeft', !!args.on); break;
      case 'interact': {
        if (args.ms !== undefined) { if (!Number.isFinite(args.ms) || args.ms < 0) throw new Error('Invalid hold duration'); key(tick, 'KeyE', true); key(tick + Math.round(args.ms * HZ / 1000), 'KeyE', false); }
        else press(tick, 'KeyE'); break;
      }
      case 'use_item': press(tick, 'KeyE'); break; // Contextual use, like a human E press.
      case 'open_inventory': press(tick, 'KeyI'); break;
      case 'type_text': for (const char of String(args.text ?? '').slice(0, 120)) press(tick, /^\d$/.test(char) ? `Digit${char}` : char === '\n' || char === '\r' ? 'Enter' : `Key${char.toUpperCase()}`, char); break;
      // Raw keyboard transitions preserve held inputs and menu keys exactly.
      case 'keydown': case 'keyup': push(tick, { ...args, type: action.tool }); break;
      case 'press_key': press(tick, args.code, args.key ?? ''); break;
      case 'wait': { const ms = args.ms ?? 0; if (!Number.isFinite(ms) || ms < 0) throw new Error('Invalid wait'); endTick = Math.max(endTick, tick + Math.round(ms * HZ / 1000)); break; }
      case 'screenshot': case 'listen': case 'note_finding': case 'abandon': break;
      default: throw new Error(`Unsupported replay tool: ${action.tool}`);
    }
  }
  inputs.sort((a, b) => a.tick - b.tick); // Stable ordering preserves simultaneous transitions.
  return { version: 1, seed, hz: HZ, inputs, endTick };
}
function validateInput(e) {
  if (e.type === 'look') { if (!Number.isFinite(e.dx) || !Number.isFinite(e.dy)) throw new Error('Invalid mouse delta'); }
  else if (!['keydown', 'keyup'].includes(e.type) || typeof e.code !== 'string') throw new Error('Invalid keyboard input');
}
export function toActionLog(recording) {
  const actions = recording.inputs.map(({ tick, type, ...args }) => ({ t: (tick - 1) * 1000 / HZ, tool: type, args }));
  actions.push({ t: Math.max(0, recording.endTick - 1) * 1000 / HZ, tool: 'wait', args: { ms: 0 } });
  return actions;
}
