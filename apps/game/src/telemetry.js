/**
 * Ground-truth observation channel. See packages/protocol/contract.ts.
 *
 * THE AGENT MUST NEVER SEE ANY OF THIS. It exists so the harness can tell
 * "this tester is stuck" from "this tester is thinking", and so persona
 * redaction knows where text is without doing OCR. If it ever reaches the
 * agent's perception channel, every finding the platform produces is worthless.
 */
const listeners = new Set();
const events = [];
let t0 = performance.now();

export function emit(event) {
  const e = { t: Math.round(performance.now() - t0), ...event };
  events.push(e);
  for (const cb of listeners) { try { cb(e); } catch { /* never let a listener break the game */ } }
}

/** Fires when a tester encounters a known injected flaw. This is the answer key. */
export function flaw(flawId) { emit({ type: 'flaw_triggered', flawId }); }

export function installTelemetry(getState, getAudioCues) {
  Object.defineProperty(window, '__telemetry', {
    value: Object.freeze({
      subscribe(cb) { listeners.add(cb); return () => listeners.delete(cb); },
      snapshot: () => getState(),
      events: () => events.slice(),
      audioCues: () => getAudioCues(),
      /**
       * Bounding boxes of on-screen text so the harness can redact pixels per
       * persona. Read from the live DOM, so it can never drift from what is
       * actually rendered.
       */
      textRegions() {
        const out = [];
        for (const el of document.querySelectorAll('[data-text-kind]')) {
          if (el.classList.contains('hidden')) continue;
          const text = (el.textContent || '').trim();
          if (!text) continue;
          const r = el.getBoundingClientRect();
          if (r.width < 1 || r.height < 1) continue;
          out.push({
            x: Math.round(r.x), y: Math.round(r.y),
            w: Math.round(r.width), h: Math.round(r.height),
            kind: el.dataset.textKind,
            words: text.split(/\s+/).length,
          });
        }
        return out;
      },
    }),
    writable: false, configurable: false, enumerable: false,
  });
}
