"use client";
import Link from "next/link";
import { liveCandidates } from "@/lib/api";
import type { PersonaConfig } from "@/lib/contract";
import type { PersonaState } from "@/lib/fleet-store";
import { usd } from "@/lib/format";
import { Avatar, StatusChip } from "@/components/ui";
import { LiveImage } from "./LiveImage";
interface PaneProps { runId: string; p: PersonaState; config?: PersonaConfig; dense: boolean; index: number; onOpen: () => void }
export function Pane({ runId, p, config, dense, index, onOpen }: PaneProps) {
  const name = config?.name ?? p.id, suffix = p.id.match(/-(\d+)$/)?.[1];
  const lives = liveCandidates(p.liveUrl || `/api/runs/${runId}/${p.id}/live`, index);
  const fallback = p.status === "queued" ? "Waiting for an available session." : p.status === "starting" ? "Preparing the game and tester." : p.status === "reporting" ? "Preparing the session report." : p.status === "failed" ? "This session failed. Open the details to review what happened." : p.status === "stopped" ? "This session was stopped." : "Waiting for the next update.";
  return <article data-pane={p.id} data-status={p.status} className="session-card">
    <div className="session-card-header"><Avatar id={p.id} name={name} size={dense ? 24 : 32}/><button onClick={onOpen} className="text-left flex-1 min-w-0 text-[14px] font-semibold hover:text-info">{name}{suffix && <span className="font-normal text-muted"> · {suffix}</span>}</button><StatusChip status={p.status} size="sm"/></div>
    <button className="session-preview" onClick={onOpen} aria-label={`Open session details for ${name}`}><LiveImage srcs={lives} active={p.status !== "queued"} fit="contain" className="absolute inset-0 h-full w-full" alt={`${name} game view`}/></button>
    <div className="session-copy"><span className="eyebrow">Latest update</span><p className="subtitle">{p.lastReasoning || (p.status === "done" ? `Report ready. ${p.findings.length} findings from this session.` : fallback)}</p></div>
    <div className="session-footer"><span>{p.steps} actions</span><span>{usd(p.cost?.usd ?? 0)}</span><span>{p.findings.length} findings</span><button className="text-info font-medium ml-auto" onClick={onOpen}>View details ↗</button>{p.status === "done" && <Link className="text-info font-medium" href={`/runs/${runId}/report`}>View report →</Link>}</div>
  </article>;
}
