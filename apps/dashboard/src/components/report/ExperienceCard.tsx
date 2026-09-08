"use client";

import { useState } from "react";
import type { PersonaConfig, PlaytestReport } from "@/lib/contract";
import type { PersonaState } from "@/lib/fleet-store";
import { usd } from "@/lib/format";
import { personaColor } from "@/lib/persona-colors";
import { Avatar, StatusChip, Tag } from "@/components/ui";

const LANES = [
  { key: "confused", label: "confused", cls: "text-amber2" },
  { key: "bored", label: "bored", cls: "text-muted" },
  { key: "unfair", label: "unfair", cls: "text-coral" },
  { key: "enjoyed", label: "enjoyed", cls: "text-ok" },
] as const;

export function ExperienceCard({ id, name, config, live, report }: { id: string; name: string; config?: PersonaConfig; live: PersonaState; report?: PlaytestReport }) {
  const [showSteps, setShowSteps] = useState(false);
  const color = personaColor(id);
  return (
    <article className="panel flex flex-col overflow-hidden" data-experience={id}>
      <div className="flex items-center gap-3 border-b border-line p-4">
        <Avatar id={id} name={name} size={40} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="display text-[19px]">{name}</span>
            {config && <span className="text-[12px] text-dim">{config.age}</span>}
          </div>
          <div className="text-[12.5px] text-muted">{live.steps} steps · {usd(live.cost?.usd ?? 0)} · {live.findings.length || report?.findings.length || 0} findings</div>
        </div>
        {report ? (
          <div className="text-right">
            <div className="flex gap-0.5" title={`would recommend ${report.wouldRecommend}/5`}>
              {[1, 2, 3, 4, 5].map((i) => <span key={i} className={`h-2.5 w-2.5 rounded-full ${i <= report.wouldRecommend ? "bg-amber" : "bg-panel3 ring-1 ring-line2"}`} />)}
            </div>
            <div className="mt-1"><Tag tone={report.completed ? "ok" : "danger"}>{report.completed ? "finished" : "abandoned"}</Tag></div>
          </div>
        ) : <StatusChip status={live.status} size="sm" />}
      </div>

      <div className="flex-1 p-4">
        {report ? (
          <>
            <p className="relative pl-5 text-[15px] italic leading-relaxed text-fg/95">
              <span className="absolute -top-1 left-0 font-display text-[28px] leading-none" style={{ color }}>“</span>
              {report.summary}
            </p>
            {report.abandonedReason && (
              <p className="mt-3 rounded-md bg-danger/10 px-3 py-2 text-[13px] text-danger ring-1 ring-danger/30"><span className="font-semibold">abandoned · </span>{report.abandonedReason}</p>
            )}
            <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-4">
              {LANES.filter((l) => report.experience[l.key].length).map((l) => (
                <div key={l.key}>
                  <p className={`eyebrow ${l.cls}`}>{l.label}</p>
                  <ul className="mt-1 space-y-0.5 text-[13.5px] leading-snug text-fg/85">
                    {report.experience[l.key].map((s, i) => <li key={i} className="flex gap-1.5"><span className="text-dim">—</span><span>{s}</span></li>)}
                  </ul>
                </div>
              ))}
            </div>
            {report.findings.length > 0 && (
              <button type="button" onClick={() => setShowSteps((s) => !s)} className="mt-4 text-[13px] font-semibold text-muted hover:text-fg">
                {showSteps ? "Hide" : "Show"} {report.findings.length} filed finding{report.findings.length === 1 ? "" : "s"} with repro steps
              </button>
            )}
            {showSteps && (
              <ul className="mt-2 space-y-3">
                {report.findings.map((f) => (
                  <li key={f.id} className="rounded-md bg-panel2 p-3 ring-1 ring-line">
                    <div className="flex items-center gap-2 text-[14px] font-semibold"><span className="font-mono text-[11px] uppercase text-coral">{f.severity}</span>{f.title}<span className="ml-auto text-[11px] text-dim">step {f.step}</span></div>
                    <ol className="mt-1.5 list-decimal space-y-0.5 pl-5 text-[13px] text-muted">{f.reproSteps.map((s, i) => <li key={i}>{s}</li>)}</ol>
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : (
          <p className="text-[14px] text-dim">{live.status === "done" ? "Loading report…" : `Session ${live.status}. Feedback will appear when the report is ready.`}</p>
        )}
      </div>
    </article>
  );
}
