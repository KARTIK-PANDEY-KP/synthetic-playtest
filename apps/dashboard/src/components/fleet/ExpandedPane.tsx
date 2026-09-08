"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { frameUrl, liveCandidates } from "@/lib/api";
import type { PersonaConfig } from "@/lib/contract";
import type { PersonaState } from "@/lib/fleet-store";
import { toRow, type StreamRow } from "@/lib/codex";
import { kTokens, usd } from "@/lib/format";
import { Avatar, SeverityChip, StatusChip, Tag } from "@/components/ui";
import { LiveImage } from "./LiveImage";
import { useSession } from "./useSession";

export function ExpandedPane({ runId, p, config, onClose, onPrev, onNext }: {
  runId: string; p: PersonaState; config?: PersonaConfig; onClose: () => void; onPrev: () => void; onNext: () => void;
}) {
  const name = config?.name ?? p.id;
  const { events, connected } = useSession(runId, p.id);
  const rows = useMemo(() => events.map(toRow).filter((r): r is StreamRow => r !== null), [events]);
  const frames = useMemo(() => {
    const out: { n: number; ref: string; step: number }[] = [];
    for (const ev of events) if (ev.kind === "action" && ev.frame) {
      const u = frameUrl(runId, ev.frame, p.id);
      if (u) out.push({ n: out.length, ref: ev.frame, step: ev.step });
    }
    return out;
  }, [events, runId, p.id]);
  const findings = useMemo(() => {
    const seen = new Map(p.findings.map((f) => [f.id, f]));
    for (const ev of events) if (ev.kind === "finding" && !seen.has(ev.finding.id)) seen.set(ev.finding.id, ev.finding);
    return [...seen.values()];
  }, [events, p.findings]);

  const [viewFrame, setViewFrame] = useState<string | null>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const streamRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (autoScroll && streamRef.current) streamRef.current.scrollTop = streamRef.current.scrollHeight;
  }, [rows.length, autoScroll]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft") onPrev();
      if (e.key === "ArrowRight") onNext();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, onPrev, onNext]);

  const lives = liveCandidates(p.liveUrl || `/api/runs/${runId}/${p.id}/live`, 0);
  const e = config?.enforcement;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-ink/95 p-3 backdrop-blur-md rise" data-expanded={p.id} onClick={onClose}>
      <div className="panel flex min-h-0 flex-1 flex-col overflow-hidden" onClick={(ev) => ev.stopPropagation()}>
        {/* header */}
        <div className="flex h-14 shrink-0 items-center gap-4 border-b border-line px-4">
          <Avatar id={p.id} name={name} size={34} />
          <div className="min-w-0 leading-tight">
            <div className="flex items-center gap-2">
              <span className="display text-[20px]">{name}</span>
              {config && <span className="text-[13px] text-dim">{config.age}</span>}
              <StatusChip status={p.status} size="sm" />
            </div>
            {config && <p className="truncate text-[13px] text-muted">{config.goal}</p>}
          </div>
          <div className="ml-auto flex items-center gap-5">
            <Readout label="step" value={String(p.steps)} sub={e ? `of ${e.step_budget}` : undefined} />
            <Readout label="cost" value={usd(p.cost?.usd ?? 0)} accent sub={p.cost ? `${kTokens(p.cost.inputTokens)} in · ${Math.round((p.cost.cachedInputTokens / Math.max(1, p.cost.inputTokens)) * 100)}% cached` : undefined} />
            <Readout label="findings" value={String(findings.length)} />
            <div className="flex items-center gap-1 border-l border-line pl-4">
              <button type="button" onClick={onPrev} className="grid h-8 w-8 place-items-center rounded-md text-muted ring-1 ring-line hover:bg-panel2 hover:text-fg" aria-label="previous persona">←</button>
              <button type="button" onClick={onNext} className="grid h-8 w-8 place-items-center rounded-md text-muted ring-1 ring-line hover:bg-panel2 hover:text-fg" aria-label="next persona">→</button>
              <button type="button" onClick={onClose} className="ml-1 grid h-8 w-8 place-items-center rounded-md bg-panel2 text-fg ring-1 ring-line2 hover:bg-panel3" aria-label="close">✕</button>
            </div>
          </div>
        </div>

        {/* body */}
        <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
          {/* left: feed + frames */}
          <div className="flex min-h-0 flex-col border-r border-line">
            <div className="relative min-h-0 flex-1 bg-black">
              {viewFrame ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={viewFrame} alt="frame the agent saw" className="absolute inset-0 h-full w-full object-contain" />
              ) : (
                <LiveImage srcs={lives} active={p.status !== "queued"} fit="contain" className="absolute inset-0 h-full w-full" alt={`${name} live`} />
              )}
              <div className="absolute left-3 top-3 flex items-center gap-2">
                {viewFrame ? (
                  <button type="button" onClick={() => setViewFrame(null)} className="rounded-md bg-amber px-2.5 py-1 font-mono text-[11px] font-bold uppercase tracking-wider text-ink">← back to live</button>
                ) : (
                  <span className="flex items-center gap-2 rounded-md bg-ink/70 px-2.5 py-1 font-mono text-[11px] uppercase tracking-wider text-fg ring-1 ring-line"><span className="live-dot" /> human view · 3 fps · $0</span>
                )}
              </div>
            </div>
            <div className="shrink-0 border-t border-line px-3 py-2">
              <div className="flex items-center justify-between">
                <span className="eyebrow">frames the agent actually saw · {frames.length}</span>
                {e && <span className="text-[12px] text-dim">{e.reading === "skim" ? "text over 12 words blurred" : e.reading === "normal" ? "text over 40 words blurred" : "no redaction"}{e.audio === "off" ? " · no listen tool" : ""}</span>}
              </div>
              <div className="mt-1.5 flex gap-1.5 overflow-x-auto pb-1" data-frames>
                {frames.length === 0 && <span className="text-[13px] text-dim">No screenshots yet.</span>}
                {[...frames].reverse().map((f) => {
                  const u = frameUrl(runId, f.ref, p.id)!;
                  return (
                    <button key={f.ref} type="button" onClick={() => setViewFrame(u)} className={`relative shrink-0 overflow-hidden rounded-md ring-1 ${viewFrame === u ? "ring-amber" : "ring-line hover:ring-line2"}`} title={`step ${f.step}`}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={u} alt={`frame at step ${f.step}`} loading="lazy" className="h-14 w-24 object-cover" />
                      <span className="absolute bottom-0 right-0 rounded-tl bg-ink/80 px-1 font-mono text-[10px] text-muted">{f.step}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* right: findings + stream */}
          <div className="flex min-h-0 flex-col">
            <div className="shrink-0 border-b border-line px-4 py-2.5">
              <div className="flex items-center justify-between">
                <span className="eyebrow">findings so far · {findings.length}</span>
                {p.status === "done" && <Link href={`/runs/${runId}/report`} className="text-[13px] font-semibold text-amber2 hover:underline">fleet report →</Link>}
              </div>
              <ul className="mt-1.5 max-h-28 space-y-1 overflow-y-auto">
                {findings.length === 0 && <li className="text-[13px] text-dim">Nothing flagged yet.</li>}
                {findings.map((f) => (
                  <li key={f.id} className="flex items-center gap-2 text-[14px]">
                    <SeverityChip value={f.severity} />
                    <span className="truncate">{f.title}</span>
                    {f.room && <span className="ml-auto shrink-0 text-[12px] text-dim">{f.room}</span>}
                  </li>
                ))}
              </ul>
            </div>

            <div className="flex shrink-0 items-center justify-between px-4 py-2">
              <span className="eyebrow">reasoning · actions · telemetry</span>
              <span className="flex items-center gap-3 text-[12px] text-dim">
                <span className="flex items-center gap-1"><span className={`h-1.5 w-1.5 rounded-full ${connected ? "bg-ok" : "bg-amber blink"}`} />{connected ? "streaming" : "connecting"}</span>
                <label className="flex items-center gap-1.5"><input type="checkbox" checked={autoScroll} onChange={(ev) => setAutoScroll(ev.target.checked)} className="accent-amber" /> follow</label>
              </span>
            </div>
            <div
              ref={streamRef}
              data-stream
              onScroll={(ev) => {
                const el = ev.currentTarget;
                const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
                if (!atBottom && autoScroll) setAutoScroll(false);
                if (atBottom && !autoScroll) setAutoScroll(true);
              }}
              className="min-h-0 flex-1 overflow-y-auto px-4 pb-4"
            >
              <ol className="space-y-1.5">
                {rows.map((r, i) => <Row key={i} r={r} />)}
              </ol>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Readout({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <span className="leading-none">
      <span className="block eyebrow !text-[10px]">{label}</span>
      <span className={`readout block text-[18px] ${accent ? "text-amber2" : "text-fg"}`}>{value}</span>
      {sub && <span className="block text-[11px] text-dim">{sub}</span>}
    </span>
  );
}

const ts = (t: number) => {
  const s = Math.floor(t / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};

function Row({ r }: { r: StreamRow }) {
  const time = <span className="readout w-11 shrink-0 pt-0.5 text-[11px] text-dim">{ts(r.t)}</span>;
  switch (r.kind) {
    case "message":
      return <li className="flex gap-3"><span className="w-11 shrink-0" />{time}<p className="text-[15px] italic leading-snug text-fg">{r.text}</p></li>;
    case "reasoning":
      return <li className="flex gap-3"><Tag>think</Tag>{time}<p className="text-[13.5px] leading-snug text-muted">{r.text.replace(/^\*\*[^*]+\*\*\s*[—-]\s*/, "")}</p></li>;
    case "tool":
      return (
        <li className="flex items-baseline gap-3">
          <Tag tone="info">tool</Tag>{time}
          <p className="font-mono text-[12.5px] text-fg">
            {r.tool}<span className="text-dim">({fmtArgs(r.args)})</span>
            {r.frame && <span className="ml-2 text-dim">→ {r.frame}</span>}
          </p>
        </li>
      );
    case "finding":
      return (
        <li className="flex items-baseline gap-3 rounded-md bg-coral/10 px-2 py-1.5 ring-1 ring-coral/30">
          <Tag tone="danger">finding</Tag>{time}
          <p className="text-[14px] font-medium text-fg">{r.title} <span className="font-mono text-[11px] uppercase text-coral">{r.severity} · {r.category}</span></p>
        </li>
      );
    case "gate":
      return (
        <li className="flex items-baseline gap-3 rounded-md bg-amber/10 px-2 py-1.5 ring-1 ring-amber/30">
          <Tag tone="amber">{r.gate}</Tag>{time}
          <p className="text-[13.5px] text-amber2">{r.detail}</p>
        </li>
      );
    case "status":
      return <li className="flex items-baseline gap-3"><Tag tone="ok">{r.status}</Tag>{time}<p className="text-[13px] text-muted">{r.detail}</p></li>;
    case "usage":
      return <li className="flex items-baseline gap-3"><Tag>usage</Tag>{time}<p className="font-mono text-[11.5px] text-dim">{kTokens(r.input)} in · {kTokens(r.cached)} cached · {r.output} out</p></li>;
    case "telemetry":
      return <li className="flex items-baseline gap-3"><Tag tone="ok">truth</Tag>{time}<p className="font-mono text-[12px] text-ok/80">{r.text}</p></li>;
  }
}

function fmtArgs(a: unknown): string {
  if (!a || typeof a !== "object") return "";
  return Object.entries(a as Record<string, unknown>).map(([k, v]) => `${k}: ${typeof v === "string" ? `"${v}"` : String(v)}`).join(", ");
}
