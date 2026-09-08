"use client";

import { frameUrl } from "@/lib/api";
import type { ClusteredFinding } from "@/lib/contract";
import { AttributionChip, Avatar, CategoryChip, SeverityChip, Tag } from "@/components/ui";

const RAIL: Record<ClusteredFinding["severity"], string> = { critical: "bg-danger", high: "bg-coral", medium: "bg-amber", low: "bg-dim" };

export function FindingCard({ f, runId, nameOf }: { f: ClusteredFinding; runId: string; nameOf: (id: string) => string }) {
  const frames = f.frames.map((ref) => ({ ref, url: frameUrl(runId, ref) })).filter((x) => x.url);
  return (
    <article className="panel relative flex overflow-hidden" data-finding={f.id}>
      <span className={`w-1.5 shrink-0 ${RAIL[f.severity]}`} />
      <div className="min-w-0 flex-1 p-4">
        <div className="flex flex-wrap items-center gap-1.5">
          <SeverityChip value={f.severity} />
          <CategoryChip value={f.category} />
          {f.ledgerId && <Tag tone={f.ledgerId.startsWith("D") ? "danger" : "amber"}>ledger {f.ledgerId}</Tag>}
          {!f.ledgerId && <Tag tone="info">emergent</Tag>}
          {f.room && <span className="text-[12px] text-dim">· {f.room}</span>}
          <span className="ml-auto"><AttributionChip value={f.attribution} /></span>
        </div>
        <h3 className="display mt-2 text-[20px] leading-tight">{f.title}</h3>

        <div className="mt-2 flex items-center gap-2">
          <span className="flex -space-x-1.5">
            {f.reporters.map((r) => <Avatar key={r.persona} id={r.persona} name={nameOf(r.persona)} size={24} ring title={`${nameOf(r.persona)} ×${r.count}`} />)}
          </span>
          <span className="text-[13px] text-muted">
            {f.reporters.map((r) => nameOf(r.persona).split(" ")[0] + (r.count > 1 ? ` ×${r.count}` : "")).join(", ")}
          </span>
        </div>

        <p className="mt-2.5 text-[14.5px] leading-snug text-fg/90">{f.description}</p>

        {frames.length > 0 && (
          <div className="mt-3 flex gap-1.5 overflow-x-auto">
            {frames.map((x) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={x.ref} src={x.url!} alt={x.ref} loading="lazy" className="h-16 w-28 shrink-0 rounded-md object-cover ring-1 ring-line" title={x.ref} />
            ))}
          </div>
        )}

        {f.verificationNote && (
          <p className={`mt-3 flex gap-2 text-[13px] leading-snug ${f.verified === true ? "text-ok/90" : f.verified === false ? "text-danger/90" : "text-muted"}`}>
            <span className="shrink-0 font-mono">{f.verified === true ? "✓ replay" : f.verified === false ? "✗ replay" : "○ unverified"}</span>
            <span className="italic">{f.verificationNote}</span>
          </p>
        )}
      </div>
    </article>
  );
}
