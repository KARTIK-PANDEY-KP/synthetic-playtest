"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { api, ApiError } from "@/lib/api";
import type { ClusteredFinding, PlaytestReport, Score } from "@/lib/contract";
import { runCost, useFleet, useRun } from "@/lib/fleet-store";
import { basePersonaId, elapsed, pct, usd } from "@/lib/format";
import { Avatar, Button, Empty, Spinner, StatusChip } from "@/components/ui";
import { Markdown } from "@/components/Markdown";
import { Analyst } from "@/components/analyst/Analyst";
import { RunNav } from "@/components/RunNav";
import { Scorecard } from "./Scorecard";
import { FindingCard } from "./FindingCard";
import { ExperienceCard } from "./ExperienceCard";
import { Disagreement } from "./Disagreement";
import { PlainEnglish } from "./PlainEnglish";

interface Analysis { findings: ClusteredFinding[]; score: Score; reportMd: string }
interface Pending { reportsIn: number; total: number }

export function ReportView({ runId }: { runId: string }) {
  const { state } = useFleet();
  const run = useRun(runId, { poll: 5000 });
  const [query, setQuery] = useState("");
  const [severity, setSeverity] = useState("all");
  const [category, setCategory] = useState("all");
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reports, setReports] = useState<Record<string, PlaytestReport>>({});
  const [plainOnly, setPlainOnly] = useState(false);

  // analysis (409 or 202+pending = still running → poll)
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const load = async () => {
      try {
        const a = await api.analysis(runId);
        if (!alive) return;
        // The orchestrator answers 202 with { status: "pending", score: null } while personas
        // are still playing (the mock used 409). Either shape means: not yet — keep polling.
        if (!a.score || (a as { status?: string }).status === "pending") {
          setPending((prev) => prev ?? { reportsIn: 0, total: 0 });
          timer = setTimeout(load, 4000);
          return;
        }
        setAnalysis(a); setPending(null); setError(null);
      } catch (e) {
        if (!alive) return;
        if (e instanceof ApiError && (e.status === 409 || e.status === 404)) {
          const b = (e.body ?? {}) as Partial<Pending>;
          setPending({ reportsIn: b.reportsIn ?? 0, total: b.total ?? 0 });
          timer = setTimeout(load, 4000);
        } else setError(e instanceof Error ? e.message : String(e));
      }
    };
    load();
    return () => { alive = false; if (timer) clearTimeout(timer); };
  }, [runId]);

  // per-persona reports (in their own voice)
  const doneIds = useMemo(() => (run ? run.order.filter((id) => run.personas[id]?.status === "done") : []), [run]);
  useEffect(() => {
    const missing = doneIds.filter((id) => !reports[id]);
    if (!missing.length) return;
    let alive = true;
    Promise.allSettled(missing.map((id) => api.report(runId, id).then((r) => [id, r] as const))).then((rs) => {
      if (!alive) return;
      setReports((prev) => {
        const next = { ...prev };
        for (const r of rs) if (r.status === "fulfilled") next[r.value[0]] = r.value[1];
        return next;
      });
    });
    return () => { alive = false; };
  }, [doneIds, reports, runId]);

  const meta = run?.meta;
  const personas = run ? run.order.map((id) => run.personas[id]).filter(Boolean) : [];
  const nameOf = (id: string) => state.personaConfigs[basePersonaId(id)]?.name ?? id;

  if (error && !analysis) return <div className="p-6"><Empty title="Couldn't load the report" hint={error} /></div>;

  if (!analysis) {
    return (
      <div className="mx-auto max-w-[1100px] px-6 py-8 rise">
        <p className="eyebrow">fleet report · {runId}</p>
        <h1 className="display mt-1 text-[30px]">Report in progress</h1><RunNav runId={runId}/>
        <p className="mt-2 text-[16px] text-muted">
          {run ? `${run.order.filter((id) => run.personas[id]?.status === "done").length} of ${run.order.length} reports in. ` : pending && pending.total ? `${pending.reportsIn} of ${pending.total} reports in. ` : ""}
          The combined report will be ready after every tester finishes. This page updates automatically.
        </p>
        <div className="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-4">
          {personas.map((p) => (
            <div key={p.id} className="panel flex items-center gap-3 p-4">
              <Avatar id={p.id} name={nameOf(p.id)} size={36} />
              <div className="flex-1">
                <div className="display text-[18px]">{nameOf(p.id)}</div>
                <div className="text-[13px] text-dim">{p.steps} steps · {usd(p.cost?.usd ?? 0)} · {p.findings.length} findings</div>
              </div>
              <StatusChip status={p.status} />
            </div>
          ))}
          {!personas.length && <div className="col-span-2 flex items-center gap-3 text-muted"><Spinner /> loading run…</div>}
        </div>
        {Object.keys(reports).length > 0 && (
          <div className="mt-8">
            <p className="eyebrow">in plain english · so far</p>
            <div className="mt-3"><PlainEnglish runId={runId} personas={personas} reports={reports} nameOf={nameOf} configs={state.personaConfigs} /></div>
          </div>
        )}
        <div className="mt-6 flex gap-3">
          <Button href={`/runs/${runId}`} variant="outline">View sessions</Button>
        </div>
      </div>
    );
  }

  const { findings, score } = analysis;
  const totalLedger = Object.entries(score.byClass).filter(([k]) => k !== "decoy").reduce((s, [, v]) => s + v.total, 0);
  const foundLedger = Object.entries(score.byClass).filter(([k]) => k !== "decoy").reduce((s, [, v]) => s + v.found, 0);
  const verified = findings.filter((f) => f.verified === true).length;
  const replayed = findings.filter((f) => f.verified !== null).length;
  const cost = runCost(run);
  const completed = Object.values(reports).filter((r) => r.completed).length;
  const rec = Object.values(reports).map((r) => r.wouldRecommend);
  const avgRec = rec.length ? rec.reduce((a, b) => a + b, 0) / rec.length : null;

  const sorted = [...findings].sort((a, b) => {
    const v = (x: ClusteredFinding) => (x.verified === true ? 0 : x.verified === null ? 1 : 2);
    if (v(a) !== v(b)) return v(a) - v(b);
    const sev = { critical: 0, high: 1, medium: 2, low: 3 };
    if (sev[a.severity] !== sev[b.severity]) return sev[a.severity] - sev[b.severity];
    return b.reporters.length - a.reporters.length;
  });
  const filtered = sorted.filter(f => (severity === "all" || f.severity === severity) && (category === "all" || f.category === category) && `${f.title} ${f.description} ${f.room ?? ""} ${f.reporters.map(r => nameOf(r.persona)).join(" ")}`.toLowerCase().includes(query.trim().toLowerCase()));
  const groups = [
    { key: "verified", title: "Verified in replay", items: filtered.filter((f) => f.verified === true) },
    { key: "unverified", title: "Awaiting verification", items: filtered.filter((f) => f.verified === null) },
    { key: "failed", title: "Did not reproduce", items: filtered.filter((f) => f.verified === false) },
  ];

  const mdBlob = `data:text/markdown;charset=utf-8,${encodeURIComponent(analysis.reportMd)}`;

  return (
    <div className="workspace" data-report onClick={event => { const link = (event.target as HTMLElement).closest<HTMLAnchorElement>('a[href^="#finding-"]'); if (link) { setPlainOnly(false); setQuery(""); setSeverity("all"); setCategory("all"); requestAnimationFrame(() => document.getElementById(link.hash.slice(1))?.scrollIntoView({ behavior: "smooth" })); } }}>
      <div className="page-heading"><div><p className="eyebrow !mt-0 break-all">Playtest report · {runId}</p><h1 className="mt-2">Results & findings</h1><p>{foundLedger} of {totalLedger} known issues found. {score.decoysFlagged.length} false alarms. {score.emergent.length} additional findings to investigate.</p></div><div className="flex gap-2 flex-wrap"><Button href={api.exportUrl(runId)} variant="outline" download>Download all data</Button><Button href={mdBlob} variant="outline" download={`${runId}-report.md`}>Download report</Button></div></div>
      <RunNav runId={runId}/>
      <nav className="report-toc" aria-label="Report sections">{[["00","Summary"],["01","Coverage"],["02",`Findings (${findings.length})`],["03","Tester feedback"],["04","Compare testers"],["05","Questions"],["06","Full report"]].map(([n,label]) => <a key={n} href={`#report-${n}`} onClick={event => { event.preventDefault(); setPlainOnly(false); requestAnimationFrame(() => document.getElementById(`report-${n}`)?.scrollIntoView({ behavior: "smooth" })); }}>{label}</a>)}</nav>

      {/* headline numbers */}
      <section className="mt-6 grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 rise" style={{ animationDelay: "80ms" }} data-headline>
        <Big label="Issue coverage (recall)" value={pct(score.recall)} sub={`${foundLedger} / ${totalLedger} known issues`} tone="amber" />
        <Big label="Finding accuracy (precision)" value={pct(score.precision)} sub={`${score.decoysFlagged.length} false alarm${score.decoysFlagged.length === 1 ? "" : "s"}`} tone={score.decoysFlagged.length ? "coral" : "ok"} />
        <Big label="Verified in replay" value={`${verified}/${replayed}`} sub="reproduced / checked" tone="ok" />
        <Big label="Additional findings" value={String(score.emergent.length)} sub="not in the known issue list" tone="violet" />
        <Big label="Total cost" value={usd(cost)} sub={`${personas.reduce((s, p) => s + (p.steps ?? 0), 0)} actions across all testers`} />
        <Big label="Recommendation" value={avgRec ? `${avgRec.toFixed(1)}/5` : "—"} sub={`${completed}/${Object.keys(reports).length || personas.length} finished the game`} />
      </section>

      {/* scorecard */}
      <Section n="00" title="In plain English" sub="One line per problem, per tester: what broke, and what they were doing when it broke."
        right={<Button variant="outline" onClick={() => setPlainOnly((v) => !v)}>{plainOnly ? "Show the detailed report" : "Hide the detailed report"}</Button>}>
        <PlainEnglish runId={runId} personas={personas} reports={reports} findings={findings} nameOf={nameOf} configs={state.personaConfigs} />
      </Section>

      {!plainOnly && <>
      <Section n="01" title="Issue coverage" sub="Compare the findings with the known issues intentionally included in this game.">
        <Scorecard score={score} findings={findings} />
      </Section>

      {/* findings */}
      <Section n="02" title="Findings" sub={`${findings.length} distinct findings across ${personas.length} testers. Search by issue, room, or tester.`}>
        <div className="panel p-4 mb-5 flex items-end flex-wrap gap-3"><label className="min-w-[180px] flex-1 text-xs font-medium text-muted">Search findings<input className="search-field mt-2" type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search findings, rooms, or testers"/></label><label className="text-xs font-medium text-muted">Severity<select className="search-field mt-2" value={severity} onChange={e => setSeverity(e.target.value)}><option value="all">All severities</option>{["critical","high","medium","low"].map(v => <option key={v} value={v}>{v[0].toUpperCase()+v.slice(1)}</option>)}</select></label><label className="text-xs font-medium text-muted">Category<select className="search-field mt-2" value={category} onChange={e => setCategory(e.target.value)}><option value="all">All categories</option>{[...new Set(findings.map(f => f.category))].map(v => <option key={v} value={v}>{v[0].toUpperCase()+v.slice(1)}</option>)}</select></label><button className="text-button mb-2" onClick={() => { setQuery(""); setSeverity("all"); setCategory("all"); }}>Clear filters</button></div>
        <p className="text-sm text-muted mb-4" aria-live="polite">Showing {filtered.length} of {findings.length} findings</p>
        {!filtered.length && <Empty title="No matching findings" hint="Try a different search or clear the filters to see every finding."/>}
        <div className="space-y-6">
          {groups.filter((g) => g.items.length).map((g) => (
            <div key={g.key}>
              <p className="eyebrow mb-2">{g.title} · {g.items.length}</p>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {g.items.map((f) => <div key={f.id} id={`finding-${f.id}`} className="scroll-mt-40"><FindingCard f={f} runId={runId} nameOf={nameOf} /></div>)}
              </div>
            </div>
          ))}
        </div>
      </Section>

      {/* experience */}
      <Section n="03" title="Tester feedback" sub="Read each tester’s experience, including what worked and where they struggled.">
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          {personas.map((p) => (
            <ExperienceCard key={p.id} id={p.id} name={nameOf(p.id)} config={state.personaConfigs[basePersonaId(p.id)]} live={p} report={reports[p.id]} />
          ))}
        </div>
      </Section>

      {/* disagreement */}
      <Section n="04" title="Compare testers" sub="See which testers reported each issue and where their experiences differ.">
        <Disagreement findings={findings} personas={personas.map((p) => p.id)} nameOf={nameOf} configs={state.personaConfigs} />
      </Section>

      {/* analyst */}
      <Section n="05" title="Ask about this playtest" sub="Explore the findings with a question of your own or choose a suggested question." right={<Link href={`/runs/${runId}/analyst`} className="text-[14px] font-semibold text-amber2 hover:underline">full screen →</Link>}>
        <Analyst runId={runId} />
      </Section>

      <Section n="06" title="Full report" sub="The complete written analysis, with findings and supporting context.">
        <details className="panel group">
          <summary className="cursor-pointer select-none px-5 py-3 text-[15px] font-semibold text-muted transition-colors hover:text-fg">
            <span className="group-open:hidden">Read the full report</span><span className="hidden group-open:inline">Hide the full report</span>
          </summary>
          <div className="border-t border-line px-6 py-5"><Markdown text={analysis.reportMd} className="text-[15.5px]" /></div>
        </details>
      </Section>
      </>}
    </div>
  );
}

function Big({ label, value, sub, tone }: { label: string; value: string; sub: string; tone?: "amber" | "ok" | "coral" | "violet" }) {
  const c = tone === "amber" ? "text-amber2" : tone === "ok" ? "text-ok" : tone === "coral" ? "text-coral" : tone === "violet" ? "text-violet" : "text-fg";
  return (
    <div className="panel px-4 py-3.5">
      <span className="eyebrow">{label}</span>
      <span className={`tabular mt-2 block text-[28px] font-semibold leading-none ${c}`}>{value}</span>
      <span className="mt-1.5 block text-[12.5px] text-dim">{sub}</span>
    </div>
  );
}

function Section({ n, title, sub, right, children }: { n: string; title: string; sub: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section id={`report-${n}`} className="report-section mt-10" data-section={n}>
      <div className="mb-4 flex flex-wrap gap-4 items-end justify-between border-b border-line pb-3">
        <div>
          <h2 className="display mt-0.5 text-[24px]">{title}</h2>
          <p className="mt-0.5 text-[14.5px] text-muted">{sub}</p>
        </div>
        {right}
      </div>
      {children}
    </section>
  );
}
