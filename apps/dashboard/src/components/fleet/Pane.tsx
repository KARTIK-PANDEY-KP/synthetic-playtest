"use client";

import Link from "next/link";
import { liveCandidates } from "@/lib/api";
import type { PersonaConfig } from "@/lib/contract";
import type { PersonaState } from "@/lib/fleet-store";
import { oneLine } from "@/lib/codex";
import { usd } from "@/lib/format";
import { Avatar, StatusChip } from "@/components/ui";
import { LiveImage } from "./LiveImage";

interface PaneProps { runId: string; p: PersonaState; config?: PersonaConfig; dense: boolean; index: number; onOpen: () => void }

export function Pane({ runId, p, config, dense, index, onOpen }: PaneProps) {
  const name = config?.name ?? p.id;
  const suffix = p.id.match(/-(\d+)$/)?.[1];
  const done = p.status === "done";
  const ended = done || p.status === "failed" || p.status === "stopped";
  const lives = liveCandidates(p.liveUrl || `/api/runs/${runId}/${p.id}/live`, index);
  const line = oneLine(p.lastReasoning);

  const ring =
    done ? "ring-2 ring-amber" :
    p.status === "playing" ? "ring-1 ring-ok/50" :
    p.status === "failed" ? "ring-2 ring-danger" : "ring-1 ring-line";

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(); } }}
      data-pane={p.id}
      data-status={p.status}
      className={`group relative min-h-0 cursor-pointer overflow-hidden rounded-xl bg-panel2 outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-info ${ring}`}
    >
      <div className={`absolute inset-0 ${ended ? "opacity-60 saturate-50" : ""} transition-all duration-700`}>
        <LiveImage srcs={lives} active={p.status !== "queued"} className="absolute inset-0 h-full w-full" alt={`${name} live`} />
      </div>

      {/* top row */}
      <div className="absolute inset-x-0 top-0 flex items-start justify-between gap-2 bg-gradient-to-b from-ink/85 via-ink/40 to-transparent p-2.5 pb-6">
        <div className="flex min-w-0 items-center gap-2">
          <Avatar id={p.id} name={name} size={dense ? 22 : 28} />
          <span className={`display truncate ${dense ? "text-[15px]" : "text-[18px]"}`}>
            {name}
            {suffix && <span className="ml-1 font-mono text-[11px] text-muted">#{suffix}</span>}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <span className={`readout rounded-md bg-ink/70 px-1.5 py-0.5 ${dense ? "text-[11px]" : "text-[12px]"} text-fg ring-1 ring-line`}>
            <span className="text-muted">step</span> {p.steps}
          </span>
          <span className={`readout rounded-md bg-ink/70 px-1.5 py-0.5 ${dense ? "text-[11px]" : "text-[12px]"} text-amber2 ring-1 ring-line`}>{usd(p.cost?.usd ?? 0)}</span>
          <StatusChip status={p.status} size="sm" />
        </div>
      </div>

      {/* bottom: ONE line of reasoning, or the report-ready band */}
      {done ? (
        <Link
          href={`/runs/${runId}/report`}
          onClick={(e) => e.stopPropagation()}
          className="flip-in absolute inset-x-0 bottom-0 flex items-center gap-3 bg-amber px-3 py-2 text-ink hover:bg-amber2"
        >
          <span className="font-mono text-[11px] font-bold uppercase tracking-[0.16em]">report ready</span>
          <span className={`truncate font-medium ${dense ? "text-[13px]" : "text-[14px]"}`}>
            {p.findings.length} finding{p.findings.length === 1 ? "" : "s"} · {p.steps} steps · {usd(p.cost?.usd ?? 0)}
          </span>
          <span className="ml-auto font-mono text-[13px]">open →</span>
        </Link>
      ) : (
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-ink/95 via-ink/60 to-transparent px-3 pb-2.5 pt-8">
          <p className={`subtitle ${dense ? "text-[13.5px]" : "text-[16px]"} text-fg`} title={p.lastReasoning}>
            {line || (p.status === "queued" ? "Waiting for a sandbox…" : p.status === "starting" ? "Booting Chromium and the persona gate…" : p.status === "reporting" ? "Writing the report…" : p.status === "failed" ? "Runner failed — open for details" : "…")}
          </p>
        </div>
      )}

      {p.findings.length > 0 && !done && (
        <span className="absolute right-2.5 top-9 rounded-md bg-coral px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider text-ink">
          {p.findings.length} finding{p.findings.length === 1 ? "" : "s"}
        </span>
      )}
    </div>
  );
}
