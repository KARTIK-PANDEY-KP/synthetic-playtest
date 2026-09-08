import { basePersonaId } from "./format";

const FIXED: Record<string, string> = {
  maya: "#4e719f",
  robert: "#668695",
  sam: "#587b66",
  priya: "#88728e",
  dana: "#4b8586",
};

const POOL = ["#ffd166", "#06d6a0", "#ef8354", "#b8f2e6", "#c79bff", "#ff9f9f", "#8be9fd", "#f1fa8c"];

export function personaColor(id: string): string {
  const base = basePersonaId(id);
  if (FIXED[base]) return FIXED[base];
  let h = 0;
  for (const ch of base) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return POOL[h % POOL.length];
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return (parts[0]?.[0] ?? "?").toUpperCase() + (parts[1]?.[0] ?? "").toUpperCase();
}
