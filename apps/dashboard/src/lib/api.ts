import type { PersonaConfig, PlaytestReport, RunMeta, SessionEvent, ClusteredFinding, Score } from "./contract";
import type { RunDetail } from "./contract";

/** Orchestrator base URL. Empty string = same origin (proxied via next.config rewrites). */
export const ORCH = (process.env.NEXT_PUBLIC_ORCHESTRATOR_URL ?? "http://localhost:4000").replace(/\/$/, "");

export class ApiError extends Error {
  constructor(public status: number, message: string, public body?: unknown) {
    super(message);
  }
}

export const url = (path: string) => `${ORCH}${path}`;

/** liveUrl/streamUrl from PersonaLive may be relative to the orchestrator */
export const resolveUrl = (u: string) => (/^https?:\/\//.test(u) ? u : `${ORCH}${u.startsWith("/") ? "" : "/"}${u}`);

const LOCAL_HOSTS = ["localhost", "127.0.0.1", "[::1]"];

/**
 * Browsers allow ~6 concurrent HTTP/1.1 connections per host, and every MJPEG pane holds one
 * open — a 9-pane grid against a single origin leaves three panes blank. For a local
 * orchestrator we spread streams across host aliases; NEXT_PUBLIC_ORCHESTRATOR_ALIASES
 * (comma-separated origins) overrides this for remote setups.
 */
function aliasOrigins(origin: string): string[] {
  const env = process.env.NEXT_PUBLIC_ORCHESTRATOR_ALIASES;
  if (env) return env.split(",").map((s) => s.trim().replace(/\/$/, "")).filter(Boolean);
  try {
    const u = new URL(origin);
    if (LOCAL_HOSTS.includes(u.hostname)) return LOCAL_HOSTS.map((h) => `${u.protocol}//${h}${u.port ? `:${u.port}` : ""}`);
  } catch { /* fall through */ }
  return [origin];
}

/** Candidate URLs for one live stream, rotated by pane index so panes spread across aliases. */
export function liveCandidates(liveUrl: string, index: number): string[] {
  const abs = resolveUrl(liveUrl);
  let origin: string, rest: string;
  try {
    const u = new URL(abs, typeof window !== "undefined" ? window.location.origin : "http://localhost");
    origin = u.origin; rest = u.pathname + u.search;
  } catch { return [abs]; }
  const origins = aliasOrigins(origin);
  const start = index % origins.length;
  return origins.map((_, i) => `${origins[(start + i) % origins.length]}${rest}`);
}

export function wsUrl(): string {
  if (ORCH) return ORCH.replace(/^http/, "ws") + "/ws";
  if (typeof window === "undefined") return "";
  return `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}/ws`;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url(path), {
    ...init,
    headers: { ...(init?.body ? { "content-type": "application/json" } : {}), ...(init?.headers ?? {}) },
    cache: "no-store",
  });
  if (!res.ok) {
    let body: unknown = undefined;
    let msg = `${res.status} ${res.statusText}`;
    try {
      body = await res.json();
      if (body && typeof body === "object" && "error" in body) msg = String((body as { error: unknown }).error);
    } catch { /* not json */ }
    throw new ApiError(res.status, msg, body);
  }
  return (await res.json()) as T;
}

export const api = {
  personas: () => request<PersonaConfig[]>("/api/personas"),
  createPersona: (p: PersonaConfig) => request<PersonaConfig>("/api/personas", { method: "POST", body: JSON.stringify(p) }),
  runs: () => request<RunMeta[]>("/api/runs"),
  run: (id: string) => request<RunDetail>(`/api/runs/${id}`),
  createRun: (body: { personas: string[]; seed?: number; backend: "local" | "modal" }) =>
    request<{ runId: string }>("/api/runs", { method: "POST", body: JSON.stringify(body) }),
  stopRun: (id: string) => request<unknown>(`/api/runs/${id}/stop`, { method: "POST" }),
  session: (id: string, persona: string) => request<SessionEvent[]>(`/api/runs/${id}/${persona}/session`),
  report: (id: string, persona: string) => request<PlaytestReport>(`/api/runs/${id}/${persona}/report`),
  analysis: (id: string) => request<{ findings: ClusteredFinding[]; score: Score; reportMd: string }>(`/api/runs/${id}/analysis`),
  ask: (id: string, question: string) => request<{ answer: string }>(`/api/runs/${id}/analysis/ask`, { method: "POST", body: JSON.stringify({ question }) }),
  exportUrl: (id: string) => url(`/api/runs/${id}/export.zip`),
  liveUrl: (id: string, persona: string) => url(`/api/runs/${id}/${persona}/live`),
  streamUrl: (id: string, persona: string) => url(`/api/runs/${id}/${persona}/stream`),
};

/**
 * Frame references appear as `frames/00012.png` (relative to the persona dir, in Finding.frame /
 * SessionEvent.action.frame) or `maya/frames/00012.png` (relative to the run dir, in
 * ClusteredFinding.frames). Both map to GET /api/runs/:id/:persona/frames/:n.
 */
export function frameUrl(runId: string, ref: string, personaFallback?: string): string | null {
  const m = ref.match(/^(?:([^/]+)\/)?frames\/0*(\d+)(?:\.png)?$/);
  if (!m) return null;
  const persona = m[1] ?? personaFallback;
  if (!persona) return null;
  return url(`/api/runs/${runId}/${persona}/frames/${Number(m[2])}`);
}

export function frameIndex(ref: string): number | null {
  const m = ref.match(/frames\/0*(\d+)(?:\.png)?$/);
  return m ? Number(m[1]) : null;
}
