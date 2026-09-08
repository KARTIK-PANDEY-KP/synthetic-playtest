"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, type ReactNode } from "react";
import { api, wsUrl } from "./api";
import type { Finding, PersonaConfig, RunMeta, PersonaLive, RunDetail, FleetEvent, Governor } from "./contract";

export type PersonaState = PersonaLive & { findings: Finding[]; lastFrame?: string; doneAt?: number };
export interface RunState { meta?: RunMeta; personas: Record<string, PersonaState>; order: string[] }
export type WsState = "connecting" | "open" | "closed";

interface State {
  runs: Record<string, RunState>;
  governor?: Governor;
  ws: WsState;
  activeRunId?: string;
  personaConfigs: Record<string, PersonaConfig>;
}

type Action =
  | { type: "run.loaded"; run: RunDetail }
  | { type: "fleet"; ev: FleetEvent; now: number }
  | { type: "ws"; ws: WsState }
  | { type: "active"; runId?: string }
  | { type: "personas"; list: PersonaConfig[] }
  | { type: "findings.seed"; runId: string; persona: string; findings: Finding[] };

const emptyRun = (): RunState => ({ personas: {}, order: [] });

function reducer(state: State, a: Action): State {
  switch (a.type) {
    case "ws":
      return state.ws === a.ws ? state : { ...state, ws: a.ws };
    case "active":
      return state.activeRunId === a.runId ? state : { ...state, activeRunId: a.runId };
    case "personas": {
      const personaConfigs: Record<string, PersonaConfig> = {};
      for (const p of a.list) personaConfigs[p.id] = p;
      return { ...state, personaConfigs };
    }
    case "findings.seed": {
      const run = state.runs[a.runId];
      const p = run?.personas[a.persona];
      if (!run || !p) return state;
      const seen = new Set(p.findings.map((f) => f.id));
      const merged = [...p.findings, ...a.findings.filter((f) => !seen.has(f.id))];
      if (merged.length === p.findings.length) return state;
      return { ...state, runs: { ...state.runs, [a.runId]: { ...run, personas: { ...run.personas, [a.persona]: { ...p, findings: merged } } } } };
    }
    case "run.loaded": {
      const { personas, ...rest } = a.run;
      const meta: RunMeta = { ...rest, personas: personas.map((p) => p.id) };
      const prev = state.runs[meta.runId] ?? emptyRun();
      const next: RunState = { meta, personas: { ...prev.personas }, order: meta.personas };
      for (const p of personas) {
        const old = prev.personas[p.id];
        next.personas[p.id] = {
          ...old,
          ...p,
          // never let a poll roll live state backwards
          steps: Math.max(p.steps, old?.steps ?? 0),
          lastReasoning: p.lastReasoning ?? old?.lastReasoning,
          findings: old?.findings ?? [],
          doneAt: old?.doneAt ?? (p.status === "done" ? Date.now() : undefined),
        };
      }
      return { ...state, runs: { ...state.runs, [meta.runId]: next } };
    }
    case "fleet": {
      const ev = a.ev;
      if (ev.type === "governor") return { ...state, governor: { tpmUsed: ev.tpmUsed, tpmLimit: ev.tpmLimit, queued: ev.queued, at: a.now } };
      const run = state.runs[ev.runId];
      if (!run) return state; // not a run we're watching
      if (ev.type === "run.done") {
        return { ...state, runs: { ...state.runs, [ev.runId]: { ...run, meta: run.meta ? { ...run.meta, status: run.meta.status === "running" ? "done" : run.meta.status, finishedAt: run.meta.finishedAt ?? new Date(a.now).toISOString() } : run.meta } } };
      }
      const p = run.personas[ev.persona];
      if (!p) return state;
      let np: PersonaState = p;
      switch (ev.type) {
        case "persona.status":
          np = { ...p, status: ev.status, doneAt: ev.status === "done" ? (p.doneAt ?? a.now) : p.doneAt };
          break;
        case "persona.step":
          np = { ...p, steps: Math.max(p.steps, ev.step), lastReasoning: ev.reasoning ?? p.lastReasoning, lastFrame: ev.frame ?? p.lastFrame };
          break;
        case "persona.cost":
          np = { ...p, cost: ev.cost };
          break;
        case "persona.finding":
          np = p.findings.some((f) => f.id === ev.finding.id) ? p : { ...p, findings: [...p.findings, ev.finding] };
          break;
      }
      if (np === p) return state;
      return { ...state, runs: { ...state.runs, [ev.runId]: { ...run, personas: { ...run.personas, [ev.persona]: np } } } };
    }
  }
}

interface Ctx {
  state: State;
  loadRun: (runId: string) => Promise<RunDetail>;
  setActiveRun: (runId?: string) => void;
  refreshPersonas: () => Promise<PersonaConfig[]>;
}

const FleetCtx = createContext<Ctx | null>(null);

export function FleetProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, { runs: {}, ws: "connecting", personaConfigs: {} });

  // Findings arrive live over the WS; on a fresh page load we recover the ones already filed
  // from each persona's session (once per persona, and again when it finishes).
  const seeded = useRef(new Set<string>());
  const loadRun = useCallback(async (runId: string) => {
    const run = await api.run(runId);
    dispatch({ type: "run.loaded", run });
    for (const p of run.personas) {
      const key = `${runId}/${p.id}/${p.status === "done" ? "done" : "live"}`;
      if (seeded.current.has(key) || p.status === "queued") continue;
      seeded.current.add(key);
      api.session(runId, p.id)
        .then((events) => {
          const findings: Finding[] = [];
          for (const ev of events) if (ev.kind === "finding") findings.push(ev.finding);
          if (findings.length) dispatch({ type: "findings.seed", runId, persona: p.id, findings });
        })
        .catch(() => seeded.current.delete(key));
    }
    return run;
  }, []);

  const setActiveRun = useCallback((runId?: string) => dispatch({ type: "active", runId }), []);

  const refreshPersonas = useCallback(async () => {
    const list = await api.personas();
    dispatch({ type: "personas", list });
    return list;
  }, []);

  useEffect(() => { refreshPersonas().catch(() => {}); }, [refreshPersonas]);

  // WebSocket to /ws with reconnect. Pages also poll GET /api/runs/:id, so a missing WS degrades gracefully.
  const retry = useRef(0);
  useEffect(() => {
    let ws: WebSocket | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let closed = false;
    const connect = () => {
      const u = wsUrl();
      if (!u) return;
      dispatch({ type: "ws", ws: "connecting" });
      try {
        ws = new WebSocket(u);
      } catch {
        dispatch({ type: "ws", ws: "closed" });
        return;
      }
      ws.onopen = () => { retry.current = 0; dispatch({ type: "ws", ws: "open" }); };
      ws.onmessage = (m) => {
        try { dispatch({ type: "fleet", ev: JSON.parse(String(m.data)) as FleetEvent, now: Date.now() }); } catch { /* ignore */ }
      };
      ws.onclose = () => {
        dispatch({ type: "ws", ws: "closed" });
        if (closed) return;
        const wait = Math.min(10_000, 1000 * 2 ** Math.min(retry.current++, 4));
        timer = setTimeout(connect, wait);
      };
      ws.onerror = () => { /* onclose follows */ };
    };
    connect();
    return () => { closed = true; if (timer) clearTimeout(timer); ws?.close(); };
  }, []);

  const value = useMemo<Ctx>(() => ({ state, loadRun, setActiveRun, refreshPersonas }), [state, loadRun, setActiveRun, refreshPersonas]);
  return <FleetCtx.Provider value={value}>{children}</FleetCtx.Provider>;
}

export function useFleet(): Ctx {
  const ctx = useContext(FleetCtx);
  if (!ctx) throw new Error("useFleet outside FleetProvider");
  return ctx;
}

/** Load a run, mark it active for the top bar, and keep polling while it runs. */
export function useRun(runId: string | undefined, { poll = 3000 }: { poll?: number } = {}) {
  const { state, loadRun, setActiveRun } = useFleet();
  const run = runId ? state.runs[runId] : undefined;
  const status = run?.meta?.status;

  useEffect(() => {
    if (!runId) return;
    setActiveRun(runId);
    return () => setActiveRun(undefined);
  }, [runId, setActiveRun]);

  useEffect(() => {
    if (!runId) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tick = async () => {
      try { await loadRun(runId); } catch { /* keep trying */ }
      if (!alive) return;
      timer = setTimeout(tick, poll);
    };
    tick();
    return () => { alive = false; if (timer) clearTimeout(timer); };
    // re-arm when status flips so we stop polling hard once done
  }, [runId, loadRun, status === "running" ? poll : poll * 5]);

  return run;
}

export const runCost = (run?: RunState) => (run ? Object.values(run.personas).reduce((s, p) => s + (p.cost?.usd ?? 0), 0) : 0);
