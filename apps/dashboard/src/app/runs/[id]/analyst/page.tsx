"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { Analyst } from "@/components/analyst/Analyst";
import { useRun } from "@/lib/fleet-store";

export default function AnalystPage() {
  const { id } = useParams<{ id: string }>();
  useRun(id, { poll: 15000 });
  return (
    <div className="mx-auto max-w-[1100px] px-6 py-6 rise">
      <div className="flex items-end justify-between">
        <div>
          <p className="eyebrow">cross-report analyst · {id}</p>
          <h1 className="display mt-1 text-[34px]">Ask the fleet</h1>
        </div>
        <Link href={`/runs/${id}/report`} className="text-[15px] font-semibold text-amber2 hover:underline">← back to report</Link>
      </div>
      <div className="mt-5"><Analyst runId={id} /></div>
    </div>
  );
}
