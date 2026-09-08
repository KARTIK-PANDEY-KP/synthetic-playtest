/**
 * The contract between the GAME and the PLATFORM.
 *
 * The game agent must ship exactly this. The platform agent may assume exactly this
 * and nothing more. Neither needs to read the other's plan.
 */

// ── 1. How the game is addressed ────────────────────────────────────────────
//   <origin>/?seed=<int>&run=<uuid>        normal play, deterministic given the seed
//   <origin>/?seed=<int>&replay=<logUrl>   deterministic replay, for verification

// ── 2. Input surface ────────────────────────────────────────────────────────
// ONLY real input, driven by Playwright keyboard/mouse. No semantic helpers —
// no goToDoor(), no listInteractables(). If the agent could call it, a human
// tester could not, and the finding would be worthless.
// Pointer lock is NOT required: mouse-drag look AND arrow-key look both work.

/** Ground-truth events. The HARNESS reads these. The AGENT NEVER SEES THEM. */
export type GameEvent =
  | { t: number; type: 'room_entered'; room: string }
  | { t: number; type: 'item_picked' | 'item_used'; item: string }
  | { t: number; type: 'puzzle_solved' | 'puzzle_failed'; puzzle: string }
  | { t: number; type: 'softlock_entered'; flawId: string }
  | { t: number; type: 'died' | 'respawned' | 'menu_opened' | 'menu_closed' }
  | { t: number; type: 'idle'; ms: number }
  | { t: number; type: 'position'; x: number; y: number; z: number; yaw: number } // 2 Hz
  /** The answer key firing: the tester has just encountered a known injected flaw. */
  | { t: number; type: 'flaw_triggered'; flawId: string };

export interface GameState {
  room: string;
  inventory: string[];
  objective: string;
  oxygen: number | null;
  solved: string[];
  softlocked: boolean;
}

export type TextRegionKind = 'tutorial' | 'hud' | 'log' | 'label' | 'menu';

export interface TextRegion {
  x: number; y: number; w: number; h: number;
  kind: TextRegionKind;
  /** Word count, so the harness can enforce a reading budget without OCR. */
  words: number;
}

export interface AudioCue {
  t: number;
  id: string;
  /** Present so the harness can grant it ONLY to personas with audio enabled. */
  transcript: string;
}

/**
 * The harness's private observation channel, exposed on `window`.
 *
 * This is the single most important interface in the project. It must never
 * influence rendering, and must never be reachable from anything the agent can
 * perceive. If it leaks into the agent's screenshots, every finding is worthless.
 */
export interface Telemetry {
  subscribe(cb: (e: GameEvent) => void): () => void;
  snapshot(): GameState;
  /** Bounding boxes of on-screen text, so the harness can redact pixels per persona. */
  textRegions(): TextRegion[];
  /** Audio cues fired this session, for the audio-enabled personas only. */
  audioCues(): AudioCue[];
}

declare global {
  interface Window { __telemetry: Telemetry }
}

// ── 4. The flaw ledger — ground truth, shipped with the game ────────────────
// apps/game/src/flaws/ledger.json

export type FlawClass =
  | 'objective'      // crashes, soft-locks, state loss — what incumbents already find
  | 'confusion'      // unclear labels, unrepeatable tutorials, hidden affordances
  | 'familiarity'    // requires a genre convention the game never taught
  | 'pacing'         // grind, dead time, no new information
  | 'fairness'       // unscaffolded inference, unannounced failure states
  | 'accessibility'  // information delivered in one modality only
  | 'decoy';         // intentional and CORRECT — measures false positives

export interface FlawLedgerEntry {
  id: string;                 // 'C1', 'B2', 'D1'…
  class: FlawClass;
  room: string;
  title: string;
  /** Which event/condition proves a tester actually hit this. */
  groundTruthSignal: string;
  /** Who we PREDICT catches it — the hypothesis the scoring pass tests. */
  expectedPersonas: string[];
}
