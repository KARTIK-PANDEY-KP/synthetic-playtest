"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { runCost, useFleet } from "@/lib/fleet-store";
import { elapsed, kTokens, usd } from "@/lib/format";

export function TopBar() {
  const { state } = useFleet();
  const path = usePathname();
  const run = state.activeRunId ? state.runs[state.activeRunId] : undefined;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(id); }, []);
  const gov = state.governor;
  const fresh = !!gov && now - gov.at <= 8000;
  const ratio = gov ? Math.min(1, gov.tpmUsed / Math.max(1, gov.tpmLimit)) : 0;
  const connected = state.ws === "open";
  return (
    <header className="app-header">
      <Link href="/" className="app-brand" aria-label="Synthetic Playtest home">
        <span className="brand-mark" aria-hidden="true"><svg width="20" height="20" viewBox="0 0 20 20" fill="none"><rect x="2" y="2" width="6" height="6" rx="1" fill="currentColor"/><rect x="12" y="2" width="6" height="6" rx="1" fill="currentColor" opacity=".5"/><rect x="2" y="12" width="6" height="6" rx="1" fill="currentColor" opacity=".5"/><rect x="12" y="12" width="6" height="6" rx="1" fill="currentColor"/></svg></span>
        <span>Synthetic Playtest<small>Testing workspace</small></span>
      </Link>
      <nav aria-label="Main navigation" className="main-nav">
        {[{ href: "/", label: "New playtest", active: path === "/" }, { href: "/runs", label: "Playtests", active: path.startsWith("/runs") }, { href: "/personas", label: "Tester library", active: path.startsWith("/personas") }].map(n => <Link key={n.href} href={n.href} aria-current={n.active ? "page" : undefined}>{n.label}</Link>)}
      </nav>
      <details className="system-status">
        <summary><span className={`status-dot ${connected ? "bg-ok" : state.ws === "connecting" ? "bg-amber" : "bg-danger"}`} /><span>{connected ? "Connected" : state.ws === "connecting" ? "Connecting" : "Disconnected"}</span><span aria-hidden="true">⌄</span></summary>
        <div className="system-popover">
          <h2>System status</h2><p className="text-muted">{connected ? "Live updates are connected." : "Live updates are unavailable. Reconnecting automatically."}</p>
          <dl className="detail-list"><div><dt>Capacity used</dt><dd>{fresh && gov ? `${kTokens(gov.tpmUsed)} / ${kTokens(gov.tpmLimit)} tokens/min` : "Waiting for an update"}</dd></div><div><dt>Sessions queued</dt><dd>{fresh ? gov?.queued : "—"}</dd></div></dl>
          <progress aria-label="Token capacity used" value={fresh ? ratio : 0} max={1} />
          {run?.meta && <><h3>Active playtest</h3><dl className="detail-list"><div><dt>Run</dt><dd className="break-all">{run.meta.runId}</dd></div><div><dt>Elapsed</dt><dd>{elapsed(run.meta.startedAt, run.meta.finishedAt, now)}</dd></div><div><dt>Total cost</dt><dd>{usd(runCost(run))}</dd></div></dl><Link href={`/runs/${run.meta.runId}`} className="text-info">Open playtest →</Link></>}
        </div>
      </details>
    </header>
  );
}
