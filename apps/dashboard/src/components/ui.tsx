"use client";

import type { ReactNode } from "react";
import type { PersonaStatus, Severity, FindingCategory } from "@/lib/contract";
import { initials, personaColor } from "@/lib/persona-colors";

// ── Status chip ──────────────────────────────────────────────────────────────
export const STATUS_STYLE: Record<PersonaStatus, { label: string; cls: string; dot: string }> = {
  queued:    { label: "queued",       cls: "bg-panel3 text-muted ring-line2",              dot: "bg-dim" },
  starting:  { label: "starting",     cls: "bg-info/15 text-info ring-info/40",            dot: "bg-info blink" },
  playing:   { label: "playing",      cls: "bg-ok/15 text-ok ring-ok/40",                  dot: "bg-ok" },
  reporting: { label: "reporting",    cls: "bg-amber/15 text-amber2 ring-amber/40",        dot: "bg-amber blink" },
  done:      { label: "report ready", cls: "bg-ok/10 text-ok ring-ok/20",                 dot: "bg-ok" },
  failed:    { label: "failed",       cls: "bg-danger/15 text-danger ring-danger/40",      dot: "bg-danger" },
  stopped:   { label: "stopped",      cls: "bg-panel3 text-muted ring-line2",              dot: "bg-dim" },
};

export function StatusChip({ status, size = "md" }: { status: PersonaStatus; size?: "sm" | "md" | "lg" }) {
  const s = STATUS_STYLE[status] ?? STATUS_STYLE.queued;
  const sz = size === "lg" ? "text-[13px] px-3 py-1.5" : size === "sm" ? "text-[10px] px-2 py-0.5" : "text-[11px] px-2.5 py-1";
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-md font-sans font-medium ring-1 ${sz} ${s.cls}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${s.dot} ${status === "playing" ? "live-dot !h-1.5 !w-1.5" : ""}`} />
      {s.label}
    </span>
  );
}

// ── Attribution chip ─────────────────────────────────────────────────────────
export function AttributionChip({ value, size = "md" }: { value: "game" | "agent" | "unclear"; size?: "sm" | "md" }) {
  const cls =
    value === "game" ? "bg-coral/10 text-coral ring-coral/20"
    : value === "agent" ? "bg-steel/10 text-steel ring-steel/20"
    : "bg-transparent text-amber2 ring-amber/60";
  const sz = size === "sm" ? "text-[10px] px-2 py-0.5" : "text-[11px] px-2.5 py-1";
  return <span className={`inline-flex items-center rounded-md font-sans font-medium ring-1 ${sz} ${cls}`}>{value}</span>;
}

// ── Severity + category ─────────────────────────────────────────────────────
export const SEVERITY_COLOR: Record<Severity, string> = {
  critical: "text-danger ring-danger/50 bg-danger/10",
  high: "text-coral ring-coral/50 bg-coral/10",
  medium: "text-amber2 ring-amber/50 bg-amber/10",
  low: "text-muted ring-line2 bg-panel3",
};
export function SeverityChip({ value }: { value: Severity }) {
  return <span className={`inline-flex items-center rounded-md px-2 py-0.5 font-sans text-[12px] font-medium ring-1 ${SEVERITY_COLOR[value]}`}>{value}</span>;
}

export const CATEGORY_LABEL: Record<FindingCategory, string> = {
  bug: "bug", confusion: "confusion", boredom: "boredom", unfair: "unfair", accessibility: "accessibility", other: "other",
};
export function CategoryChip({ value }: { value: FindingCategory }) {
  return <span className="inline-flex items-center rounded-md bg-panel3 px-2 py-0.5 font-sans text-[12px] font-medium text-muted ring-1 ring-line2">{CATEGORY_LABEL[value] ?? value}</span>;
}

export function Tag({ children, tone = "muted" }: { children: ReactNode; tone?: "muted" | "ok" | "amber" | "danger" | "info" }) {
  const cls = {
    muted: "bg-panel3 text-muted ring-line2",
    ok: "bg-ok/10 text-ok ring-ok/40",
    amber: "bg-amber/10 text-amber2 ring-amber/40",
    danger: "bg-danger/10 text-danger ring-danger/40",
    info: "bg-info/10 text-info ring-info/40",
  }[tone];
  return <span className={`inline-flex items-center rounded-md px-2 py-0.5 font-sans text-[12px] font-medium ring-1 ${cls}`}>{children}</span>;
}

// ── Avatar ───────────────────────────────────────────────────────────────────
export function Avatar({ id, name, size = 32, ring = false, title }: { id: string; name: string; size?: number; ring?: boolean; title?: string }) {
  const c = personaColor(id);
  return (
    <span
      title={title ?? name}
      className={`inline-grid shrink-0 place-items-center rounded-full font-sans font-semibold ${ring ? "ring-2 ring-ink" : ""}`}
      style={{ width: size, height: size, background: `${c}20`, color: "var(--color-fg)", border: "1px solid var(--color-line)", fontSize: Math.round(size * 0.42) }}
    >
      {initials(name)}
    </span>
  );
}

// ── Buttons ──────────────────────────────────────────────────────────────────
export function Button({ children, onClick, href, variant = "primary", disabled, className = "", type = "button", download }: {
  children: ReactNode; onClick?: () => void; href?: string; variant?: "primary" | "ghost" | "danger" | "outline"; disabled?: boolean; className?: string; type?: "button" | "submit"; download?: string | boolean;
}) {
  const base = "inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-[15px] font-semibold transition-all disabled:cursor-not-allowed disabled:opacity-40";
  const v = {
    primary: "bg-amber text-white hover:bg-amber2 active:translate-y-px",
    ghost: "bg-transparent text-muted hover:bg-panel2 hover:text-fg",
    outline: "bg-transparent text-fg ring-1 ring-line2 hover:bg-panel2",
    danger: "bg-danger/15 text-danger ring-1 ring-danger/40 hover:bg-danger/25",
  }[variant];
  if (href) return <a href={href} download={download} className={`${base} ${v} ${className}`}>{children}</a>;
  return <button type={type} onClick={onClick} disabled={disabled} className={`${base} ${v} ${className}`}>{children}</button>;
}

export function Segmented<T extends string>({ value, options, onChange, labels }: { value: T; options: readonly T[]; onChange: (v: T) => void; labels?: Partial<Record<T, string>> }) {
  return (
    <div className="inline-flex rounded-lg bg-panel2 p-1 ring-1 ring-line">
      {options.map((o) => (
        <button
          key={o}
          type="button"
          onClick={() => onChange(o)}
          aria-pressed={o === value}
          className={`rounded-md px-3 py-1.5 text-[14px] font-medium capitalize transition-colors ${o === value ? "bg-white text-info shadow-sm" : "text-muted hover:text-fg"}`}
        >
          {labels?.[o] ?? o}
        </button>
      ))}
    </div>
  );
}

export function Empty({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="panel grid place-items-center px-6 py-14 text-center">
      <p className="display text-2xl text-muted">{title}</p>
      {hint && <p className="mt-2 max-w-md text-[15px] text-dim">{hint}</p>}
    </div>
  );
}

export function Spinner({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-block h-4 w-4 animate-spin rounded-full border-2 border-amber border-t-transparent ${className}`} aria-label="loading" />
  );
}
