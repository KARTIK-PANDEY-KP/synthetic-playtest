"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { RunNav } from "@/components/RunNav";
import { Analyst } from "@/components/analyst/Analyst";
import { useRun } from "@/lib/fleet-store";

export default function AnalystPage() {
  const { id } = useParams<{ id: string }>();
  useRun(id, { poll: 15000 });
  return (
    <div className="workspace">
      <div className="flex flex-wrap gap-4 items-end justify-between mb-6">
        <div>
          <p className="eyebrow">cross-report analyst · {id}</p>
          <h1 className="display mt-1 text-[34px]">Ask about this playtest</h1>
        </div>
        <Link href={`/runs/${id}/report`} className="text-[15px] font-semibold text-amber2 hover:underline">← back to report</Link>
      </div>
      <RunNav runId={id}/>
      <p className="text-muted text-sm mb-6">Ask questions about the findings, compare tester experiences, or decide what to investigate next.</p>
      <div className="mt-5"><Analyst runId={id} /></div>
    </div>
  );
}
