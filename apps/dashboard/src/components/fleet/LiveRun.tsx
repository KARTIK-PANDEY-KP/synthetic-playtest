"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { useFleet, useRun } from "@/lib/fleet-store";
import { basePersonaId } from "@/lib/format";
import { Button, Empty, Spinner } from "@/components/ui";
import { Pane } from "./Pane";
import { ExpandedPane } from "./ExpandedPane";

export function gridFor(n: number): { cols: number; rows: number } {
  if (n <= 1) return { cols: 1, rows: 1 };
  if (n === 2) return { cols: 2, rows: 1 };
  if (n <= 4) return { cols: 2, rows: 2 };
  if (n <= 6) return { cols: 3, rows: 2 };
  if (n <= 9) return { cols: 3, rows: 3 };
  if (n <= 12) return { cols: 4, rows: 3 };
  if (n <= 16) return { cols: 4, rows: 4 };
  return { cols: 5, rows: Math.ceil(n / 5) };
}

export function LiveRun({ runId }: { runId: string }) {
  const { state } = useFleet();
  const run = useRun(runId);
  const [focus, setFocus] = useState<string | null>(null);
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!run) {
      const t = setTimeout(() => api.run(runId).catch((e) => setError(e.message)), 1500);
      return () => clearTimeout(t);
    }
  }, [run, runId]);

  const personas = useMemo(() => (run ? run.order.map((id) => run.personas[id]).filter(Boolean) : []), [run]);
  const { cols, rows } = gridFor(personas.length);
  const dense = personas.length > 6;
  const meta = run?.meta;
  const allDone = personas.length > 0 && personas.every((p) => ["done", "failed", "stopped"].includes(p.status));
  const doneCount = personas.filter((p) => p.status === "done").length;

  const stop = async () => {
    setStopping(true);
    try { await api.stopRun(runId); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setStopping(false); }
  };

  if (error && !run) return <div className="p-6"><Empty title="Run not found" hint={error} /></div>;
  if (!run || !meta) {
    return (
      <div className="grid h-full place-items-center">
        <div className="flex items-center gap-3 text-muted"><Spinner /> connecting to run {runId}…</div>
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-3.5rem)] flex-col">
      {/* run strip */}
      <div className="flex h-10 shrink-0 items-center gap-4 border-b border-line px-4 text-[14px]">
        <span className="eyebrow">run</span>
        <span className="font-medium">{meta.runId}</span>
        <span className="text-dim">seed {meta.seed} · {meta.backend} · {personas.length} agent{personas.length === 1 ? "" : "s"}</span>
        <span className="flex items-center gap-1.5 text-dim">
          {meta.status === "running" ? <><span className="live-dot" /> live</> : <><span className="h-2 w-2 rounded-full bg-amber" /> {meta.status}</>}
        </span>
        <span className="ml-auto text-dim">{doneCount}/{personas.length} reports in</span>
        {meta.status === "running" && (
          <Button variant="danger" onClick={stop} disabled={stopping} className="!px-3 !py-1 !text-[13px]">{stopping ? "stopping…" : "Stop run"}</Button>
        )}
        <Link
          href={`/runs/${runId}/report`}
          className={`rounded-lg px-3 py-1 text-[13px] font-semibold ring-1 transition-colors ${allDone ? "bg-amber text-ink ring-amber hover:bg-amber2" : "text-muted ring-line2 hover:text-fg"}`}
        >
          {allDone ? "Open fleet report →" : "Report (pending)"}
        </Link>
      </div>

      {/* grid */}
      <div
        className="grid min-h-0 flex-1 gap-2 p-2"
        style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))` }}
        data-grid-cols={cols}
        data-grid-rows={rows}
      >
        {personas.map((p, i) => (
          <Pane key={p.id} runId={runId} p={p} config={state.personaConfigs[basePersonaId(p.id)]} dense={dense} index={i} onOpen={() => setFocus(p.id)} />
        ))}
      </div>

      {focus && run.personas[focus] && (
        <ExpandedPane
          runId={runId}
          p={run.personas[focus]}
          config={state.personaConfigs[basePersonaId(focus)]}
          onClose={() => setFocus(null)}
          onPrev={() => setFocus(run.order[(run.order.indexOf(focus) - 1 + run.order.length) % run.order.length])}
          onNext={() => setFocus(run.order[(run.order.indexOf(focus) + 1) % run.order.length])}
        />
      )}
    </div>
  );
}
