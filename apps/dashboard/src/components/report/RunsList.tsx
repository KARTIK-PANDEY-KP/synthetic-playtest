"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { RunMeta } from "@/lib/contract";
import { useFleet } from "@/lib/fleet-store";
import { basePersonaId, elapsed, relTime } from "@/lib/format";
import { Avatar, Empty, Spinner, Tag } from "@/components/ui";

export function RunsList() {
  const { state } = useFleet();
  const [runs, setRuns] = useState<RunMeta[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () => api.runs().then((r) => alive && setRuns(r)).catch((e) => alive && setError(e.message));
    load();
    const t = setInterval(load, 5000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  return (
    <div className="mx-auto max-w-[1240px] px-6 py-6 rise">
      <p className="eyebrow">archive</p>
      <h1 className="display mt-1 text-[32px]">Runs</h1>
      {error && <p className="mt-3 text-danger">{error}</p>}
      {!runs && !error && <div className="mt-6 flex items-center gap-3 text-muted"><Spinner /> loading…</div>}
      {runs && runs.length === 0 && <div className="mt-6"><Empty title="No runs yet" hint="Launch a fleet from the Fleet tab." /></div>}
      {runs && runs.length > 0 && (
        <div className="panel mt-5 overflow-hidden">
          <table className="w-full text-[15px]">
            <thead>
              <tr className="text-left">
                {["run", "status", "fleet", "seed", "backend", "started", "duration", ""].map((h) => (
                  <th key={h} className="eyebrow border-b border-line px-4 py-3 font-normal">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {runs.map((r) => (
                <tr key={r.runId} className="hover:bg-panel2/60">
                  <td className="px-4 py-3 font-medium">{r.runId}</td>
                  <td className="px-4 py-3">
                    <Tag tone={r.status === "running" ? "ok" : r.status === "done" ? "amber" : r.status === "failed" ? "danger" : "muted"}>{r.status}</Tag>
                  </td>
                  <td className="px-4 py-3">
                    <span className="flex -space-x-1.5">
                      {r.personas.map((id) => <Avatar key={id} id={id} name={state.personaConfigs[basePersonaId(id)]?.name ?? id} size={26} ring />)}
                    </span>
                  </td>
                  <td className="readout px-4 py-3">{r.seed}</td>
                  <td className="px-4 py-3 text-muted">{r.backend}</td>
                  <td className="px-4 py-3 text-muted">{relTime(r.startedAt)}</td>
                  <td className="readout px-4 py-3 text-muted">{elapsed(r.startedAt, r.finishedAt)}</td>
                  <td className="px-4 py-3 text-right">
                    <Link href={`/runs/${r.runId}`} className="mr-3 text-info hover:underline">{r.status === "running" ? "watch live" : "grid"}</Link>
                    <Link href={`/runs/${r.runId}/report`} className="font-semibold text-amber2 hover:underline">report →</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
