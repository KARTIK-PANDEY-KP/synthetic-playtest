"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { runCost, useFleet } from "@/lib/fleet-store";
import { elapsed, kTokens, usd } from "@/lib/format";

const NAV = [
  { href: "/", label: "Fleet" },
  { href: "/personas", label: "Personas" },
  { href: "/runs", label: "Runs" },
];

export function TopBar() {
  const { state } = useFleet();
  const path = usePathname();
  const run = state.activeRunId ? state.runs[state.activeRunId] : undefined;
  const meta = run?.meta;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const cost = runCost(run);
  const gov = state.governor;
  const govStale = gov ? now - gov.at > 8000 : true;
  const used = gov?.tpmUsed ?? 0;
  const limit = gov?.tpmLimit ?? 500_000;
  const ratio = Math.min(1, used / limit);
  const headroom = Math.max(0, 1 - ratio);
  const barColor = ratio > 0.92 ? "bg-danger" : ratio > 0.72 ? "bg-amber" : "bg-ok";

  const personas = run ? Object.values(run.personas) : [];
  const done = personas.filter((p) => p.status === "done").length;

  return (
    <header className="sticky top-0 z-40 h-14 shrink-0 border-b border-line bg-ink/85 backdrop-blur-md">
      <div className="flex h-full items-center gap-6 px-4">
        <Link href="/" className="flex items-center gap-3">
          <span className="grid h-7 w-7 place-items-center rounded-md bg-amber text-ink">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
              <path d="M2 12 L8 3 L14 12 Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
              <circle cx="8" cy="10" r="1.6" fill="currentColor" />
            </svg>
          </span>
          <span className="whitespace-nowrap leading-none">
            <span className="block eyebrow !text-[10px] text-amber2">synthetic playtest</span>
            <span className="display block text-[18px] text-fg">Fleet Control</span>
          </span>
        </Link>

        <nav className="flex items-center gap-0.5 text-[15px]">
          {NAV.map((n) => {
            const active = n.href === "/" ? path === "/" || path.startsWith("/runs/") && !path.includes("/report") && !path.includes("/analyst") : path.startsWith(n.href);
            return (
              <Link key={n.href} href={n.href} className={`rounded-md px-3 py-1.5 transition-colors ${active ? "bg-panel2 text-fg" : "text-muted hover:text-fg"}`}>
                {n.label}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-5 whitespace-nowrap">
          {meta ? (
            <>
              <Readout label="run" value={meta.runId.length > 16 ? meta.runId.slice(0, 15) + "…" : meta.runId} mono={false} />
              <Readout label="elapsed" value={elapsed(meta.startedAt, meta.finishedAt, now)} />
              <Readout label="reports" value={`${done}/${personas.length}`} />
              <Readout label="cost" value={usd(cost)} accent />
            </>
          ) : (
            <span className="eyebrow">no active run</span>
          )}

          <div className="flex items-center gap-2.5 border-l border-line pl-4" title="Rate governor: tokens per minute used vs. tier limit">
            <span className="leading-none">
              <span className="block eyebrow !text-[10px]">tpm headroom</span>
              <span className={`readout block text-[15px] ${govStale ? "text-dim" : "text-fg"}`}>
                {kTokens(used)} <span className="text-dim">/ {kTokens(limit)}</span>
              </span>
            </span>
            <div className="relative h-3 w-28 overflow-hidden rounded-full bg-panel3 ring-1 ring-line2">
              <div className={`absolute inset-y-0 left-0 rounded-full ${barColor} transition-[width] duration-700`} style={{ width: `${ratio * 100}%` }} />
              {[0.25, 0.5, 0.75].map((t) => (
                <span key={t} className="absolute inset-y-0 w-px bg-ink/60" style={{ left: `${t * 100}%` }} />
              ))}
            </div>
            <span className={`readout w-11 text-right text-[14px] ${ratio > 0.92 ? "text-danger" : ratio > 0.72 ? "text-amber" : "text-ok"}`}>{Math.round(headroom * 100)}%</span>
            {gov && gov.queued > 0 && (
              <span className="whitespace-nowrap rounded-md bg-danger/15 px-2 py-0.5 font-mono text-[11px] uppercase tracking-wider text-danger ring-1 ring-danger/40">
                {gov.queued} queued
              </span>
            )}
            <span
              className={`h-2 w-2 rounded-full ${state.ws === "open" ? "bg-ok" : state.ws === "connecting" ? "bg-amber blink" : "bg-danger"}`}
              title={`fleet socket: ${state.ws}`}
            />
          </div>
        </div>
      </div>
    </header>
  );
}

function Readout({ label, value, accent, mono = true }: { label: string; value: string; accent?: boolean; mono?: boolean }) {
  return (
    <span className="leading-none">
      <span className="block eyebrow !text-[10px]">{label}</span>
      <span className={`block text-[15px] ${mono ? "readout" : "font-medium"} ${accent ? "text-amber2" : "text-fg"}`}>{value}</span>
    </span>
  );
}
