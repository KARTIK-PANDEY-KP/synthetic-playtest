"use client";

import type { ClusteredFinding, Finding, PersonaConfig, PlaytestReport } from "@/lib/contract";
import Link from "next/link";
import { Avatar } from "@/components/ui";
import { frameUrl } from "@/lib/api";

/**
 * The executive view: one card per tester, one line per problem — what broke, and what
 * the tester was doing when it broke. Built from the per-persona reports (so it fills in
 * as each tester finishes) and, once the cross-persona pass has run, the cluster verdicts.
 */
type Live = { id: string; status: string; steps: number; findings: unknown[] };

const VERDICT: Record<ClusteredFinding["attribution"], { label: string; cls: string }> = {
  game: { label: "the game", cls: "bg-emerald-500/15 text-ok border-emerald-500/30" },
  agent: { label: "this tester", cls: "bg-zinc-500/15 text-muted border-zinc-500/30" },
  unclear: { label: "unclear", cls: "bg-amber-500/15 text-info border-amber-500/30" },
};
const SEV: Record<Finding["severity"], string> = { critical: "text-danger", high: "text-coral", medium: "text-info", low: "text-muted" };

const firstSentence = (s?: string) => (s ?? "").split(/(?<=[.!?])\s/)[0].trim();
const lower = (s?: string) => (s ? s.charAt(0).toLowerCase() + s.slice(1) : "");

const list = (xs: string[]) => xs.length === 0 ? "" : xs.length === 1 ? xs[0] : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;
const nice = (id: string) => id.replace(/_/g, " ");

/** "Step 12 of 90, 3.4 min in, in the transit concourse (airlock → transit concourse). Objective: Restore power. Carrying nothing; nothing solved yet." */
function situation(f: Finding): string | null {
  const st = f.state; if (!st) return null;
  const room = (st.room ?? f.room ?? "").toLowerCase();
  const path = st.roomsVisited.length > 1 ? ` (${st.roomsVisited.map(nice).join(" → ")})` : "";
  const parts = [
    `Step ${st.stepsSoFar}${st.stepBudget ? ` of ${st.stepBudget}` : ""}${st.minutesIn ? `, ${st.minutesIn} min in` : ""}${room ? `, in the ${nice(room)}` : ""}${path}.`,
    st.objective ? `Objective: ${st.objective}.` : "",
    st.inventory.length ? `Carrying ${list(st.inventory.map(nice))}.` : "Carrying nothing.",
    st.solved.length ? `Already solved: ${list(st.solved.map(nice))}.` : "Nothing solved yet.",
  ];
  return parts.filter(Boolean).join(" ");
}

/** "They walked forward, pressed E ×3 and listened — then thought: “…”" */
function path(f: Finding): string | null {
  const acts = f.actionsBefore ?? [];
  const did = acts.length ? `They ${list(acts)}` : "";
  const thought = f.thinking ? `${did ? " — then thought: " : "Their last thought: "}“${firstSentence(f.thinking)}”` : "";
  const out = did + thought;
  return out || null;
}

/** Older runs have no stamped context: fall back to the tester's own description. */
function whatHappened(f: Finding): string {
  const d = (f.description ?? "").trim();
  const two = d.split(/(?<=[.!?])\s/).slice(0, 2).join(" ");
  return two || firstSentence(d);
}

export function PlainEnglish({ runId, personas, reports, findings, nameOf, configs }: {
  runId: string;
  personas: Live[];
  reports: Record<string, PlaytestReport>;
  findings?: ClusteredFinding[];
  nameOf: (id: string) => string;
  configs: Record<string, PersonaConfig | undefined>;
}) {
  const clusterOf = (personaId: string, findingId: string) =>
    findings?.find((c) => c.reporters.some((r) => r.persona === personaId && r.findingIds?.includes(findingId)));

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {personas.map((p) => {
        const cfg = configs[p.id.replace(/-\d+$/, "")];
        const report = reports[p.id];
        const who = cfg ? `${cfg.age} · ${firstSentence(cfg.bio)}` : "";
        const items = report ? [...report.findings].sort((a, b) => a.step - b.step) : [];
        return (
          <article key={p.id} className="panel p-5" data-plain={p.id}>
            <div className="flex flex-wrap items-center gap-3">
              <Avatar id={p.id} name={nameOf(p.id)} size={36} />
              <div className="min-w-0">
                <div className="display text-[20px] leading-tight">{nameOf(p.id)}</div>
                {who && <div className="text-[13px] leading-relaxed text-dim">{who}</div>}
              </div>
              <div className="ml-auto text-[13px] text-dim">
                {report ? `${items.length} problem${items.length === 1 ? "" : "s"} · ${p.steps} steps` : p.status === "done" ? "report loading…" : `still playing · ${p.steps} steps`}
              </div>
            </div>

            {report && !items.length && (
              <p className="mt-4 text-[15px] text-muted">No problems reported. {firstSentence(report.summary)}</p>
            )}

            {items.length > 0 && (
              <ol className="mt-4 space-y-3">
                {items.map((f, i) => {
                  const c = clusterOf(p.id, f.id);
                  return (
                    <li key={f.id} className="border-l-2 border-line pl-3">
                      <div className="flex flex-wrap items-baseline gap-x-2">
                        <span className="text-[12px] text-dim tabular-nums">{i + 1}.</span>
                        <span className={`display text-[17px] leading-snug ${SEV[f.severity]}`}>{f.title}</span>
                        <span className="text-[12px] uppercase tracking-wide text-dim">{f.severity} · {f.category}</span>
                      </div>
                      <div className="mt-1.5 flex flex-wrap gap-3">
                        <div className="min-w-0 flex-1 space-y-1 text-[14.5px] leading-relaxed text-muted">
                          {situation(f) && <p><span className="text-dim">Where they were:</span> {situation(f)}</p>}
                          {path(f) && <p><span className="text-dim">How they got here:</span> {path(f)}</p>}
                          <p><span className="text-dim">What happened:</span> {whatHappened(f)}</p>
                        </div>
                        {f.frame && frameUrl(runId, f.frame, p.id) && (
                          <a href={frameUrl(runId, f.frame, p.id)!} target="_blank" rel="noreferrer" title="What they saw at that moment — open full size" className="shrink-0">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={frameUrl(runId, f.frame, p.id)!} alt={`Screenshot for ${f.title}`} className="h-[68px] w-[121px] rounded border border-line object-cover" />
                          </a>
                        )}
                      </div>
                      <div className="mt-1.5 flex flex-wrap gap-1.5 text-[12px]">
                        {c && <a href={`#finding-${c.id}`} className="rounded border border-line px-1.5 py-0.5 text-dim hover:text-info">details ↓</a>}
                        <Link href={`/runs/${runId}?expand=${encodeURIComponent(p.id)}`} className="rounded border border-line px-1.5 py-0.5 text-dim hover:text-info">watch the play-through →</Link>
                      </div>
                      {c && (
                        <div className="mt-1.5 flex flex-wrap gap-1.5 text-[12px]">
                          <span className={`rounded border px-1.5 py-0.5 ${VERDICT[c.attribution].cls}`}>fault: {VERDICT[c.attribution].label}</span>
                          {c.reporters.length > 1 && <span className="rounded border border-line px-1.5 py-0.5 text-dim">{c.reporters.length} testers hit this</span>}
                          {c.verified === true && <span className="rounded border border-emerald-500/30 px-1.5 py-0.5 text-ok">reproduced by replay</span>}
                          {c.verified === false && <span className="rounded border border-red-500/30 px-1.5 py-0.5 text-danger">did not reproduce</span>}
                          {c.ledgerId && <span className="rounded border border-line px-1.5 py-0.5 text-dim">known flaw {c.ledgerId}</span>}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ol>
            )}

            {report && (
              <p className="mt-4 border-t border-line pt-3 text-[13.5px] italic text-dim">
                {report.completed ? "Finished the game." : `Quit${report.abandonedReason ? `: ${lower(firstSentence(report.abandonedReason))}` : "."}`} Would recommend {report.wouldRecommend}/5.
              </p>
            )}
          </article>
        );
      })}
    </div>
  );
}
