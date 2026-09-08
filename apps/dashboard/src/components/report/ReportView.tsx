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
import { Scorecard } from "./Scorecard";
import { FindingCard } from "./FindingCard";
import { ExperienceCard } from "./ExperienceCard";
import { Disagreement } from "./Disagreement";

interface Analysis { findings: ClusteredFinding[]; score: Score; reportMd: string }
interface Pending { reportsIn: number; total: number }

const NUM = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen"];
const words = (n: number) => NUM[n] ?? String(n);

export function ReportView({ runId }: { runId: string }) {
  const { state } = useFleet();
  const run = useRun(runId, { poll: 5000 });
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reports, setReports] = useState<Record<string, PlaytestReport>>({});

  // analysis (409 = still running → poll)
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const load = async () => {
      try {
        const a = await api.analysis(runId);
        if (!alive) return;
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
        <h1 className="display mt-1 text-[36px]">Analysis pending</h1>
        <p className="mt-2 text-[16px] text-muted">
          {pending ? `${pending.reportsIn} of ${pending.total} reports in. ` : ""}
          The cross-persona pass (cluster → verify → score) runs once the last agent files its report.
        </p>
        <div className="mt-6 grid grid-cols-2 gap-3">
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
        <div className="mt-6 flex gap-3">
          <Link href={`/runs/${runId}`}><Button variant="outline">← watch the fleet live</Button></Link>
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
  const groups = [
    { key: "verified", title: "Verified — replayed at the same seed, reproduced", items: sorted.filter((f) => f.verified === true) },
    { key: "unverified", title: "Not yet verified — no ground-truth signal to assert against", items: sorted.filter((f) => f.verified === null) },
    { key: "failed", title: "Did not reproduce", items: sorted.filter((f) => f.verified === false) },
  ];

  const mdBlob = `data:text/markdown;charset=utf-8,${encodeURIComponent(analysis.reportMd)}`;

  return (
    <div className="mx-auto max-w-[1240px] px-6 py-6" data-report>
      {/* header */}
      <header className="rise flex items-start justify-between gap-6">
        <div>
          <p className="eyebrow">
            fleet report · {runId}{meta ? ` · seed ${meta.seed} · ${meta.backend} · ${personas.length} testers · ${elapsed(meta.startedAt, meta.finishedAt)}` : ""}
          </p>
          <h1 className="display mt-2 text-[44px] leading-[1.02] text-balance">
            <span className="text-amber2">{cap(words(foundLedger))} of {words(totalLedger)}</span> injected flaws found.{" "}
            {score.decoysFlagged.length ? <>{cap(words(score.decoysFlagged.length))} false alarm{score.decoysFlagged.length === 1 ? "" : "s"}.</> : <>No false alarms.</>}{" "}
            {score.emergent.length ? <span className="text-muted">{cap(words(score.emergent.length))} thing{score.emergent.length === 1 ? "" : "s"} nobody planted.</span> : null}
          </h1>
        </div>
        <div className="flex shrink-0 gap-2 pt-1">
          <Button href={api.exportUrl(runId)} variant="outline" download>↓ export.zip</Button>
          <Button href={mdBlob} variant="outline" download={`${runId}-report.md`}>↓ report.md</Button>
          <Link href={`/runs/${runId}`}><Button variant="ghost">grid</Button></Link>
        </div>
      </header>

      {/* headline numbers */}
      <section className="mt-6 grid grid-cols-6 gap-3 rise" style={{ animationDelay: "80ms" }} data-headline>
        <Big label="recall" value={pct(score.recall)} sub={`${foundLedger} / ${totalLedger} ledger flaws`} tone="amber" />
        <Big label="precision" value={pct(score.precision)} sub={`${score.decoysFlagged.length} decoy${score.decoysFlagged.length === 1 ? "" : "s"} flagged`} tone={score.decoysFlagged.length ? "coral" : "ok"} />
        <Big label="verified" value={`${verified}/${replayed}`} sub="replayed findings reproduce" tone="ok" />
        <Big label="emergent" value={String(score.emergent.length)} sub="unledgered, looks real" tone="violet" />
        <Big label="fleet cost" value={usd(cost)} sub={`${personas.reduce((s, p) => s + (p.steps ?? 0), 0)} steps · gpt-6-astra`} />
        <Big label="would recommend" value={avgRec ? `${avgRec.toFixed(1)}/5` : "—"} sub={`${completed}/${Object.keys(reports).length || personas.length} finished the game`} />
      </section>

      {/* scorecard */}
      <Section n="01" title="Scorecard" sub="Findings joined against ledger.json — the answer key nobody else has.">
        <Scorecard score={score} findings={findings} />
      </Section>

      {/* findings */}
      <Section n="02" title="Findings" sub={`${findings.length} clustered across ${personas.length} testers. Verified first.`}>
        <div className="space-y-6">
          {groups.filter((g) => g.items.length).map((g) => (
            <div key={g.key}>
              <p className="eyebrow mb-2">{g.title} · {g.items.length}</p>
              <div className="grid grid-cols-2 gap-3">
                {g.items.map((f) => <FindingCard key={f.id} f={f} runId={runId} nameOf={nameOf} />)}
              </div>
            </div>
          ))}
        </div>
      </Section>

      {/* experience */}
      <Section n="03" title="In their own words" sub="The subjective narrative per tester — where they got confused, bored, treated unfairly.">
        <div className="grid grid-cols-3 gap-3">
          {personas.map((p) => (
            <ExperienceCard key={p.id} id={p.id} name={nameOf(p.id)} config={state.personaConfigs[basePersonaId(p.id)]} live={p} report={reports[p.id]} />
          ))}
        </div>
      </Section>

      {/* disagreement */}
      <Section n="04" title="Where the fleet disagreed" sub="Findings split along enforcement lines, not personality. That is the argument for enforcing personas in the harness.">
        <Disagreement findings={findings} personas={personas.map((p) => p.id)} nameOf={nameOf} configs={state.personaConfigs} />
      </Section>

      {/* analyst */}
      <Section n="05" title="Ask the fleet" sub="One gpt-6-astra call with every report in context. Three questions, on purpose." right={<Link href={`/runs/${runId}/analyst`} className="text-[14px] font-semibold text-amber2 hover:underline">full screen →</Link>}>
        <Analyst runId={runId} />
      </Section>

      <Section n="06" title="Cross-persona report" sub="analysis/report.md, as written by the analysis pass.">
        <details className="panel group">
          <summary className="cursor-pointer select-none px-5 py-3 text-[15px] font-semibold text-muted transition-colors hover:text-fg">
            <span className="group-open:hidden">Show report.md</span><span className="hidden group-open:inline">Hide report.md</span>
          </summary>
          <div className="border-t border-line px-6 py-5"><Markdown text={analysis.reportMd} className="text-[15.5px]" /></div>
        </details>
      </Section>
    </div>
  );
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function Big({ label, value, sub, tone }: { label: string; value: string; sub: string; tone?: "amber" | "ok" | "coral" | "violet" }) {
  const c = tone === "amber" ? "text-amber2" : tone === "ok" ? "text-ok" : tone === "coral" ? "text-coral" : tone === "violet" ? "text-violet" : "text-fg";
  return (
    <div className="panel px-4 py-3.5">
      <span className="eyebrow">{label}</span>
      <span className={`readout mt-1 block text-[34px] leading-none ${c}`}>{value}</span>
      <span className="mt-1.5 block text-[12.5px] text-dim">{sub}</span>
    </div>
  );
}

function Section({ n, title, sub, right, children }: { n: string; title: string; sub: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="mt-10 rise" data-section={n}>
      <div className="mb-4 flex items-end justify-between border-b border-line pb-3">
        <div>
          <p className="eyebrow">{n}</p>
          <h2 className="display mt-0.5 text-[30px]">{title}</h2>
          <p className="mt-0.5 text-[14.5px] text-muted">{sub}</p>
        </div>
        {right}
      </div>
      {children}
    </section>
  );
}
