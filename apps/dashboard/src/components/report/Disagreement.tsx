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
    });

  if (!rows.length) return <p className="text-muted">No differences in reported findings are available for this playtest.</p>;

  return (
    <div className="panel overflow-x-auto" data-disagreement>
      <table className="w-full min-w-[720px]">
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
                    {c && <span className="text-[12px] text-dim">{c.enforcement.reading} · {c.enforcement.genre_familiarity} · {c.enforcement.audio === "off" ? "mute" : "audio"}</span>}
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
                      <span className="mx-auto grid h-8 w-8 place-items-center rounded-full text-[13px] font-bold text-fg" style={{ background: `${personaColor(id)}20` }}>✓</span>
                    ) : (
                      <span className="text-muted" aria-label="Not reported">—</span>
                    )}
                  </td>
                ))}
                <td className="max-w-[360px] px-4 py-3 text-[13.5px] leading-snug text-muted">{f.description}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
