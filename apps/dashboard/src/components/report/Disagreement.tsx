"use client";

import type { ClusteredFinding, PersonaConfig } from "@/lib/contract";
import { basePersonaId } from "@/lib/format";
import { personaColor } from "@/lib/persona-colors";
import { AttributionChip, Avatar, Tag } from "@/components/ui";

/** Matrix of who reported what, for the findings the fleet did NOT agree on. */
export function Disagreement({ findings, personas, nameOf, configs }: {
  findings: ClusteredFinding[]; personas: string[]; nameOf: (id: string) => string; configs: Record<string, PersonaConfig>;
}) {
  const n = personas.length;
  const rows = findings
    .filter((f) => f.reporters.length > 0 && f.reporters.length < n)
    .sort((a, b) => {
      const w = (x: ClusteredFinding) => (x.attribution === "unclear" ? 0 : x.attribution === "agent" ? 1 : 2);
      if (w(a) !== w(b)) return w(a) - w(b);
      return a.reporters.length - b.reporters.length;
    })
    .slice(0, 9);

  if (!rows.length) return <p className="text-muted">Everyone agreed on everything. That never happens.</p>;

  return (
    <div className="panel overflow-hidden" data-disagreement>
      <table className="w-full">
        <thead>
          <tr>
            <th className="eyebrow px-4 py-3 text-left font-normal">finding</th>
            {personas.map((id) => {
              const c = configs[basePersonaId(id)];
              return (
                <th key={id} className="px-2 py-3 text-center">
                  <div className="flex flex-col items-center gap-1">
                    <Avatar id={id} name={nameOf(id)} size={30} />
                    <span className="text-[12px] font-medium">{nameOf(id).split(" ")[0]}</span>
                    {c && <span className="font-mono text-[9.5px] uppercase tracking-wider text-dim">{c.enforcement.reading} · {c.enforcement.genre_familiarity} · {c.enforcement.audio === "off" ? "mute" : "audio"}</span>}
                  </div>
                </th>
              );
            })}
            <th className="eyebrow px-4 py-3 text-left font-normal">why</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((f) => {
            const hit = new Set(f.reporters.map((r) => r.persona));
            return (
              <tr key={f.id} className="hover:bg-panel2/50">
                <td className="max-w-[300px] px-4 py-3">
                  <div className="flex items-center gap-2">
                    <AttributionChip value={f.attribution} size="sm" />
                    {f.ledgerId && <Tag>{f.ledgerId}</Tag>}
                  </div>
                  <div className="mt-1 text-[15px] font-semibold leading-snug">{f.title}</div>
                  <div className="text-[12px] text-dim">{f.reporters.length} of {n} reported</div>
                </td>
                {personas.map((id) => (
                  <td key={id} className="px-2 py-3 text-center">
                    {hit.has(id) ? (
                      <span className="mx-auto grid h-8 w-8 place-items-center rounded-full text-[13px] font-bold text-ink" style={{ background: personaColor(id) }}>✓</span>
                    ) : (
                      <span className="mx-auto block h-8 w-8 rounded-full ring-1 ring-inset ring-line2" />
                    )}
                  </td>
                ))}
                <td className="max-w-[360px] px-4 py-3 text-[13.5px] leading-snug text-muted">{firstSentences(f.description, 2)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function firstSentences(s: string, n: number): string {
  const parts = s.match(/[^.!?]+[.!?]+/g) ?? [s];
  return parts.slice(0, n).join(" ").trim();
}
