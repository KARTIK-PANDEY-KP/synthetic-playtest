"use client";

import type { ClusteredFinding, FlawClass, Score } from "@/lib/contract";
import { pct } from "@/lib/format";
import { Tag } from "@/components/ui";

const CLASS_ORDER: FlawClass[] = ["objective", "confusion", "familiarity", "pacing", "fairness", "accessibility", "decoy"];
const CLASS_NOTE: Record<FlawClass, string> = {
  objective: "crashes, soft-locks, state loss — what incumbents already find",
  confusion: "unclear labels, unrepeatable tutorials, hidden affordances",
  familiarity: "requires a genre convention the game never taught",
  pacing: "grind, dead time, no new information",
  fairness: "unscaffolded inference, unannounced failure states",
  accessibility: "information delivered in one modality only",
  decoy: "intentional and correct — flagged means false positive",
};

export function Scorecard({ score, findings }: { score: Score; findings: ClusteredFinding[] }) {
  const byLedger = new Map(findings.filter((f) => f.ledgerId).map((f) => [f.ledgerId!, f]));
  return (
    <div className="grid grid-cols-12 gap-4" data-scorecard>
      <div className="col-span-8 panel overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="text-left">
              <th className="eyebrow px-4 py-2.5 font-normal">class</th>
              <th className="eyebrow px-4 py-2.5 font-normal">found / total</th>
              <th className="eyebrow w-[42%] px-4 py-2.5 font-normal">recall</th>
              <th className="eyebrow px-4 py-2.5 text-right font-normal">rate</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {CLASS_ORDER.map((c) => {
              const v = score.byClass[c];
              if (!v) return null;
              const decoy = c === "decoy";
              const r = v.total ? v.found / v.total : 0;
              return (
                <tr key={c} className={decoy ? "bg-danger/5" : ""}>
                  <td className="px-4 py-3">
                    <div className={`text-[16px] font-semibold capitalize ${decoy ? "text-danger" : ""}`}>{c}</div>
                    <div className="text-[12px] text-dim">{CLASS_NOTE[c]}</div>
                  </td>
                  <td className="readout px-4 py-3 text-[18px]">
                    <span className={decoy ? "text-danger" : "text-fg"}>{v.found}</span>
                    <span className="text-dim"> / {v.total}</span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex h-3 w-full gap-0.5">
                      {Array.from({ length: v.total }).map((_, i) => (
                        <span
                          key={i}
                          className={`h-full flex-1 rounded-sm ${i < v.found ? (decoy ? "bg-danger" : c === "accessibility" ? "bg-violet" : "bg-amber") : "bg-panel3 ring-1 ring-inset ring-line2"}`}
                        />
                      ))}
                    </div>
                  </td>
                  <td className={`readout px-4 py-3 text-right text-[16px] ${decoy ? "text-danger" : r >= 0.75 ? "text-ok" : r >= 0.5 ? "text-amber2" : "text-coral"}`}>
                    {decoy ? `${v.found} FP` : pct(r)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="col-span-4 space-y-3">
        <ChipBlock label={`found · ${score.found.length}`} tone="ok">
          {score.found.map((id) => <LedgerChip key={id} id={id} f={byLedger.get(id)} tone="ok" />)}
        </ChipBlock>
        <ChipBlock label={`missed · ${score.missed.length}`} tone="muted">
          {score.missed.map((id) => <Tag key={id}>{id}</Tag>)}
        </ChipBlock>
        <ChipBlock label={`decoys flagged · ${score.decoysFlagged.length}`} tone="danger">
          {score.decoysFlagged.length ? score.decoysFlagged.map((id) => <LedgerChip key={id} id={id} f={byLedger.get(id)} tone="danger" />) : <span className="text-[13px] text-dim">none</span>}
        </ChipBlock>
        <ChipBlock label={`emergent · ${score.emergent.length}`} tone="violet">
          {score.emergent.length ? score.emergent.map((id) => {
            const f = findings.find((x) => x.id === id);
            return <span key={id} className="inline-flex items-center gap-1.5 rounded-md bg-violet/10 px-2 py-0.5 text-[13px] text-violet ring-1 ring-violet/40"><span className="font-mono text-[11px]">{id}</span>{f ? ` ${f.title}` : ""}</span>;
          }) : <span className="text-[13px] text-dim">none</span>}
        </ChipBlock>
      </div>
    </div>
  );
}

function ChipBlock({ label, tone, children }: { label: string; tone: "ok" | "muted" | "danger" | "violet"; children: React.ReactNode }) {
  const c = { ok: "text-ok", muted: "text-muted", danger: "text-danger", violet: "text-violet" }[tone];
  return (
    <div className="panel p-3.5">
      <p className={`eyebrow ${c}`}>{label}</p>
      <div className="mt-2 flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}

function LedgerChip({ id, f, tone }: { id: string; f?: ClusteredFinding; tone: "ok" | "danger" }) {
  const cls = tone === "ok" ? "bg-ok/10 text-ok ring-ok/40" : "bg-danger/10 text-danger ring-danger/40";
  return (
    <span title={f?.title} className={`inline-flex items-center rounded-md px-2 py-0.5 font-mono text-[12px] ring-1 ${cls}`}>
      {id}{f ? <span className="ml-1 font-sans text-[11px] opacity-70">×{f.reporters.reduce((s, r) => s + r.count, 0)}</span> : null}
    </span>
  );
}
