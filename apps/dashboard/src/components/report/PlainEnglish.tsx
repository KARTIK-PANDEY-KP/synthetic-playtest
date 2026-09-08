"use client";

import type { ClusteredFinding, Finding, PersonaConfig, PlaytestReport } from "@/lib/contract";
import { Avatar } from "@/components/ui";

/**
 * The executive view: one card per tester, one line per problem — what broke, and what
 * the tester was doing when it broke. Built from the per-persona reports (so it fills in
 * as each tester finishes) and, once the cross-persona pass has run, the cluster verdicts.
 */
type Live = { id: string; status: string; steps: number; findings: unknown[] };

const VERDICT: Record<ClusteredFinding["attribution"], { label: string; cls: string }> = {
  game: { label: "the game", cls: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30" },
  agent: { label: "this tester", cls: "bg-zinc-500/15 text-zinc-300 border-zinc-500/30" },
  unclear: { label: "unclear", cls: "bg-amber-500/15 text-amber-300 border-amber-500/30" },
};
const SEV: Record<Finding["severity"], string> = { critical: "text-red-300", high: "text-orange-300", medium: "text-amber-200", low: "text-zinc-300" };

const firstSentence = (s?: string) => (s ?? "").split(/(?<=[.!?])\s/)[0].trim();
const lower = (s?: string) => (s ? s.charAt(0).toLowerCase() + s.slice(1) : "");

function howFound(f: Finding): string {
  const where = f.room ? `In the ${f.room.toLowerCase()}` : "";   // agents capitalize rooms inconsistently
  const doing = f.actionsBefore?.length ? `after ${f.actionsBefore.join(", ")}` : "";
  const lead = [where, doing].filter(Boolean).join(", ");
  if (f.thinking) return `${lead ? lead + " — " : ""}“${firstSentence(f.thinking)}”`;
  // Older runs have no stamped context: fall back to the tester's own description.
  return `${lead ? lead + ". " : ""}${firstSentence(f.description)}`;
}

export function PlainEnglish({ personas, reports, findings, nameOf, configs }: {
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
            <div className="flex items-center gap-3">
              <Avatar id={p.id} name={nameOf(p.id)} size={36} />
              <div className="min-w-0">
                <div className="display text-[20px] leading-tight">{nameOf(p.id)}</div>
                {who && <div className="truncate text-[13px] text-dim">{who}</div>}
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
                      <p className="mt-1 text-[14.5px] leading-relaxed text-muted">{howFound(f)}</p>
                      {c && (
                        <div className="mt-1.5 flex flex-wrap gap-1.5 text-[12px]">
                          <span className={`rounded border px-1.5 py-0.5 ${VERDICT[c.attribution].cls}`}>fault: {VERDICT[c.attribution].label}</span>
                          {c.reporters.length > 1 && <span className="rounded border border-line px-1.5 py-0.5 text-dim">{c.reporters.length} testers hit this</span>}
                          {c.verified === true && <span className="rounded border border-emerald-500/30 px-1.5 py-0.5 text-emerald-300">reproduced by replay</span>}
                          {c.verified === false && <span className="rounded border border-red-500/30 px-1.5 py-0.5 text-red-300">did not reproduce</span>}
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
