import type { SessionEvent } from "./contract";

export type StreamRow =
  | { kind: "message"; text: string; t: number }
  | { kind: "reasoning"; text: string; t: number }
  | { kind: "tool"; tool: string; args: unknown; result?: string; step?: number; frame?: string; t: number }
  | { kind: "finding"; title: string; severity: string; category: string; t: number }
  | { kind: "gate"; gate: string; detail: string; t: number }
  | { kind: "status"; status: string; detail?: string; t: number }
  | { kind: "usage"; input: number; cached: number; output: number; t: number }
  | { kind: "telemetry"; text: string; t: number };

type CodexItem = { type?: string; text?: string; tool?: string; server?: string; arguments?: unknown; status?: string };
type CodexEvent = { type?: string; item?: CodexItem; usage?: { input_tokens?: number; cached_input_tokens?: number; output_tokens?: number } };

/** Pull the human-readable line out of a raw `codex exec --json` event, if it has one. */
export function codexLine(ev: unknown): { kind: "message" | "reasoning"; text: string } | null {
  const e = ev as CodexEvent;
  if (!e || typeof e !== "object") return null;
  const item = e.item;
  if (e.type === "item.completed" && item) {
    if (item.type === "agent_message" && item.text) return { kind: "message", text: item.text.trim() };
    if (item.type === "reasoning" && item.text) return { kind: "reasoning", text: item.text.trim() };
  }
  return null;
}

/** Flatten a SessionEvent to a row for the expanded stream. Skips noise (tool-call bookkeeping, position telemetry). */
export function toRow(ev: SessionEvent): StreamRow | null {
  switch (ev.kind) {
    case "codex": {
      const line = codexLine(ev.event);
      return line ? { ...line, t: ev.t } : null;
    }
    case "action":
      return { kind: "tool", tool: ev.tool, args: ev.args, result: ev.result, step: ev.step, frame: ev.frame, t: ev.t };
    case "finding":
      return { kind: "finding", title: ev.finding.title, severity: ev.finding.severity, category: ev.finding.category, t: ev.t };
    case "gate":
      return { kind: "gate", gate: ev.gate, detail: ev.detail, t: ev.t };
    case "status":
      return { kind: "status", status: ev.status, detail: ev.detail, t: ev.t };
    case "usage":
      return { kind: "usage", input: ev.input, cached: ev.cached, output: ev.output, t: ev.t };
    case "telemetry": {
      const g = ev.event;
      if (g.type === "position" || g.type === "idle") return null;
      const text =
        g.type === "room_entered" ? `entered ${g.room}` :
        g.type === "item_picked" || g.type === "item_used" ? `${g.type.replace("_", " ")}: ${g.item}` :
        g.type === "puzzle_solved" || g.type === "puzzle_failed" ? `${g.type.replace("_", " ")}: ${g.puzzle}` :
        g.type === "flaw_triggered" ? `flaw triggered: ${g.flawId}` :
        g.type === "softlock_entered" ? `soft-lock: ${g.flawId}` : g.type;
      return { kind: "telemetry", text, t: ev.t };
    }
    default:
      return null;
  }
}

/** One line for a grid pane: the latest agent_message, else the latest reasoning summary. */
export function latestLine(events: SessionEvent[]): string | undefined {
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i];
    if (ev.kind === "codex") {
      const l = codexLine(ev.event);
      if (l?.kind === "message") return l.text;
    }
  }
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i];
    if (ev.kind === "codex") {
      const l = codexLine(ev.event);
      if (l) return l.text;
    }
  }
  return undefined;
}

export const oneLine = (s: string | undefined, max = 160) => {
  if (!s) return "";
  const t = s.replace(/\s+/g, " ").replace(/^\*\*[^*]+\*\*\s*[—-]\s*/, "").trim();
  return t.length > max ? t.slice(0, max - 1) + "…" : t;
};
