// Shared types come from the protocol package (type-only, erased at build).
export type * from "../../../../packages/protocol/contract";

import type { CostSummary, Finding, PersonaStatus, RunMeta } from "../../../../packages/protocol/contract";

/** From docs/INTERFACES.md — ORCHESTRATOR HTTP/WS API */
export interface PersonaLive {
  id: string;
  status: PersonaStatus;
  steps: number;
  cost: CostSummary;
  lastReasoning?: string;
  liveUrl: string;
  streamUrl: string;
}

/** GET /api/runs/:id — RunMeta with `personas` expanded from ids to live state */
export type RunDetail = Omit<RunMeta, "personas"> & { personas: PersonaLive[] };

export type FleetEvent =
  | { type: "persona.status"; runId: string; persona: string; status: PersonaStatus }
  | { type: "persona.step"; runId: string; persona: string; step: number; reasoning?: string; frame?: string }
  | { type: "persona.finding"; runId: string; persona: string; finding: Finding }
  | { type: "persona.cost"; runId: string; persona: string; cost: CostSummary }
  | { type: "run.done"; runId: string }
  | { type: "governor"; tpmUsed: number; tpmLimit: number; queued: number };

export interface Governor { tpmUsed: number; tpmLimit: number; queued: number; at: number }

export const PRESET_QUESTIONS = [
  "What did all personas struggle with, and what did only some struggle with — and why?",
  "Which three findings should the developer fix first?",
  "Which findings are the agents' fault, not the game's?",
] as const;

// gpt-6-astra pricing, per million tokens (mirrors ASTRA_PRICE in the contract)
export const ASTRA_PRICE = { input: 10, cachedInput: 1, output: 50 } as const;
