/** Private observation channel: never read by the game or its renderer. */
export function installTelemetry(game) {
  const listeners = new Set();
  game.emitCallback = event => { for (const cb of listeners) { try { cb(structuredClone(event)); } catch { /* Observers cannot interrupt simulation. */ } } };
  Object.defineProperty(window, '__telemetry', {
    value: Object.freeze({
      subscribe(cb) { listeners.add(cb); return () => listeners.delete(cb); },
      snapshot: () => structuredClone(game.state),
      events: () => structuredClone(game.events),
      audioCues: () => structuredClone(game.audio),
      textRegions() {
        const out = [];
        for (const el of document.querySelectorAll('[data-text-kind]')) {
          if (el.closest('.hidden') || !el.getClientRects().length) continue;
          const style = getComputedStyle(el);
          if (style.visibility === 'hidden' || style.display === 'none') continue;
          const text = (el.textContent || '').trim();
          const r = el.getBoundingClientRect();
          if (!text || r.width < 1 || r.height < 1) continue;
          out.push({ x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), kind: el.dataset.textKind, words: text.split(/\s+/).length });
        }
        return out;
      },
    }), writable: false, configurable: false, enumerable: false,
  });
}

/**
 * Harness-facing replay status (contract: window.__replay = { done, events }).
 * Lives here, not in main.js: rendering code must never reference the observation
 * channel, and the game's own verify script enforces that with a grep.
 * Returns the function the simulation loop calls when the recording is exhausted.
 */
export function installReplayStatus(game) {
  const status = { done: false, get events() { return structuredClone(game.events); } };
  Object.defineProperty(window, '__replay', { value: status, writable: false, configurable: false, enumerable: false });
  return () => { status.done = true; };
}
