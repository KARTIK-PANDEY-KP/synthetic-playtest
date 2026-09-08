"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";
import { runCost, useFleet, useRun } from "@/lib/fleet-store";
import { basePersonaId, usd } from "@/lib/format";
import { Button, Empty, Spinner, Segmented, StatusChip } from "@/components/ui";
import { RunNav } from "@/components/RunNav";
import { Pane } from "./Pane";
import { ExpandedPane } from "./ExpandedPane";
import { useSearchParams } from "next/navigation";

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
  const [view, setView] = useState<"readable" | "fit" | "list">("readable");
  const [focus, setFocus] = useState<string | null>(null);
  // /runs/<id>?expand=<persona> — deep link from the plain-English report into the play-through
  const searchParams = useSearchParams();
  const expandParam = searchParams.get("expand");
  const openedLink = useRef<string | null>(null);
  useEffect(() => { const key = `${runId}:${expandParam}`; if (expandParam && run?.personas[expandParam] && openedLink.current !== key) { openedLink.current = key; setFocus(expandParam); } }, [expandParam, run, runId]);
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
    <div className={`live-workspace ${view === "fit" ? "fit-mode" : ""}`}>
      <div className="page-heading"><div><h1>Playtest sessions</h1><p className="break-all">{meta.runId} · {personas.length} testers · {meta.status === "running" ? "In progress" : meta.status}</p></div><div className="flex items-center gap-3">{meta.status === "running" && <Button variant="danger" onClick={stop} disabled={stopping}>{stopping ? "Stopping…" : "Stop playtest"}</Button>}<Button href={`/runs/${runId}/report`} variant={allDone ? "primary" : "outline"}>View report →</Button></div></div>
      <RunNav runId={runId}/>
      {error && <p role="alert" className="text-danger mb-4">{error}</p>}
      <dl className="run-metrics"><div><dt>Active sessions</dt><dd>{personas.filter(p => ["starting", "playing", "reporting"].includes(p.status)).length}</dd></div><div><dt>Reports ready</dt><dd>{doneCount} <span className="text-muted text-base font-normal">/ {personas.length}</span></dd></div><div><dt>Findings reported</dt><dd>{personas.reduce((sum,p) => sum + p.findings.length, 0)}</dd></div><div><dt>Total cost</dt><dd>{usd(runCost(run))}</dd></div></dl>
      <div className="flex items-center justify-between gap-4 mb-4 flex-wrap"><p className="text-sm text-muted">Open a session to see its full activity, screenshots, and findings.</p><Segmented value={view} options={["readable", "fit", "list"] as const} labels={{ readable: "Readable", fit: "Fit all", list: "List" }} onChange={setView}/></div>
      {view === "list" ? <div className="panel overflow-x-auto"><table className="data-table"><thead><tr>{["Tester", "Status", "Actions", "Findings", "Cost", "Latest update", ""].map((h,i) => <th key={i} scope="col">{h || <span className="sr-only">Details</span>}</th>)}</tr></thead><tbody>{personas.map(p => <tr key={p.id}><td className="font-medium">{state.personaConfigs[basePersonaId(p.id)]?.name ?? p.id}</td><td><StatusChip status={p.status} size="sm"/></td><td>{p.steps}</td><td>{p.findings.length}</td><td>{usd(p.cost?.usd ?? 0)}</td><td className="min-w-[240px] max-w-lg text-muted leading-relaxed">{p.lastReasoning || "Waiting for an update."}</td><td><button className="text-info whitespace-nowrap" onClick={() => setFocus(p.id)}>View details</button></td></tr>)}</tbody></table></div> : <div className="session-grid" style={view === "fit" ? { gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))` } : undefined} data-grid-cols={view === "fit" ? cols : 2} data-grid-rows={rows}>
        {personas.map((p,i) => <Pane key={p.id} runId={runId} p={p} config={state.personaConfigs[basePersonaId(p.id)]} dense={view === "fit" && dense} index={i} onOpen={() => setFocus(p.id)}/>)}
      </div>}
      {!personas.length && <Empty title="No sessions yet" hint="Sessions will appear here when the playtest starts."/>}

      {focus && run.personas[focus] && (
        <ExpandedPane
          key={focus}
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
