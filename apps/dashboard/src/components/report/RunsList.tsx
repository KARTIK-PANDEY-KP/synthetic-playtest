"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { RunMeta } from "@/lib/contract";
import { useFleet } from "@/lib/fleet-store";
import { basePersonaId, elapsed, relTime } from "@/lib/format";
import { Empty, Spinner, Tag, Button } from "@/components/ui";
export function RunsList() {
  const { state } = useFleet();
  const [runs, setRuns] = useState<RunMeta[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  useEffect(() => { let alive = true; const load = () => api.runs().then(r => { if (alive) { setRuns(r); setError(null); } }).catch(e => alive && setError(e.message)); load(); const t = setInterval(load,5000); return () => { alive=false; clearInterval(t); }; }, []);
  const visible = runs?.filter(r => (status === "all" || r.status === status) && `${r.runId} ${r.personas.map(id => state.personaConfigs[basePersonaId(id)]?.name ?? id).join(" ")}`.toLowerCase().includes(query.trim().toLowerCase())) ?? [];
  return <div className="workspace"><div className="page-heading"><div><h1>Playtests</h1><p>Review previous results, return to a live session, or compare repeated tests.</p></div><Button href="/">New playtest</Button></div>
    {error && <p role="alert" className="mb-5 text-danger">{error}</p>}
    {!runs && !error && <div className="flex gap-3 items-center text-muted"><Spinner/>Loading playtests…</div>}
    {runs && !runs.length && <Empty title="No playtests yet" hint="Start a playtest to see its sessions and results here."/>}
    {runs && runs.length > 0 && <section className="panel overflow-hidden"><div className="toolbar"><input type="search" aria-label="Search playtests" className="search-field" placeholder="Search by playtest ID or tester name" value={query} onChange={e => setQuery(e.target.value)}/><select className="search-field !flex-none !w-auto" aria-label="Filter playtests by status" value={status} onChange={e => setStatus(e.target.value)}><option value="all">All statuses</option><option value="running">In progress</option><option value="done">Completed</option><option value="failed">Failed</option><option value="stopped">Stopped</option></select><span className="text-xs text-muted" aria-live="polite">{visible.length} of {runs.length} playtests</span></div><div className="overflow-x-auto"><table className="data-table"><thead><tr>{["Playtest","Status","Testers","Started","Duration",""].map((h,i) => <th key={i} scope="col">{h || <span className="sr-only">Actions</span>}</th>)}</tr></thead><tbody>{visible.map(r => <tr key={r.runId}><td><Link href={`/runs/${r.runId}`} className="font-semibold text-info break-all">{r.runId}</Link><p className="text-xs text-muted mt-1">Seed {r.seed} · {r.backend === "modal" ? "Cloud" : "This computer"}</p></td><td><Tag tone={r.status === "running" ? "ok" : r.status === "failed" ? "danger" : "muted"}>{r.status === "running" ? "In progress" : r.status === "done" ? "Completed" : r.status}</Tag></td><td className="min-w-[180px] max-w-[300px]"><span className="text-sm">{r.personas.length} sessions</span><details className="text-xs mt-1 text-muted"><summary className="text-info">View testers ⌄</summary><ul className="mt-2 space-y-1">{r.personas.map((id,i) => <li key={`${id}-${i}`}>{state.personaConfigs[basePersonaId(id)]?.name ?? id}</li>)}</ul></details></td><td className="whitespace-nowrap text-muted"><time title={new Date(r.startedAt).toLocaleString()}>{relTime(r.startedAt)}</time></td><td className="tabular text-muted">{elapsed(r.startedAt,r.finishedAt)}</td><td className="whitespace-nowrap"><Link className="text-info mr-4" href={`/runs/${r.runId}`}>{r.status === "running" ? "Watch live" : "View sessions"}</Link><Link className="text-info" href={`/runs/${r.runId}/report`}>Report →</Link></td></tr>)}</tbody></table></div>{!visible.length && <div className="p-8 text-center"><p className="text-muted mb-2">No playtests match these filters.</p><button className="text-button" onClick={() => { setQuery(""); setStatus("all"); }}>Clear filters</button></div>}</section>}
  </div>;
}
