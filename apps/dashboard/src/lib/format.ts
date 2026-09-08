export const usd = (n: number, digits = 2) => `$${n.toFixed(digits)}`;

export function kTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 100_000 ? 0 : 1)}K`;
  return String(n);
}

export function elapsed(fromIso: string, toIso?: string, now = Date.now()): string {
  const from = Date.parse(fromIso);
  const to = toIso ? Date.parse(toIso) : now;
  const s = Math.max(0, Math.floor((to - from) / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

export function relTime(iso: string, now = Date.now()): string {
  const d = Math.round((now - Date.parse(iso)) / 1000);
  if (d < 60) return `${d}s ago`;
  if (d < 3600) return `${Math.round(d / 60)} min ago`;
  if (d < 86400) return `${Math.round(d / 3600)} h ago`;
  return new Date(iso).toLocaleDateString();
}

export const pct = (n: number) => `${Math.round(n * 100)}%`;

export const shortRunId = (id: string) => (id.length > 14 ? `${id.slice(0, 12)}…` : id);

/** base persona id for a fleet instance id such as `maya-2` */
export const basePersonaId = (instanceId: string) => instanceId.replace(/-\d+$/, "");
