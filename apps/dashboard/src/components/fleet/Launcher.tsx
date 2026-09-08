"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";
import type { PersonaConfig, RunMeta } from "@/lib/contract";
import { useFleet } from "@/lib/fleet-store";
import { kTokens, relTime, usd } from "@/lib/format";
import { Avatar, Button, Segmented, Spinner, Tag } from "@/components/ui";
const STEP_USD = 0.117;
const TPM_PER_AGENT = 62_000;
const TPM_LIMIT = 500_000;
const reading = { skim: "Skims text", normal: "Typical reader", thorough: "Reads carefully" };
const familiarity = { none: "First-time player", medium: "Some experience", high: "Experienced player" };

export function Launcher() {
  const router = useRouter();
  const { state, refreshPersonas } = useFleet();
  const personas = useMemo(() => Object.values(state.personaConfigs), [state.personaConfigs]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const initialized = useRef(false);
  const [query, setQuery] = useState("");
  const [seed, setSeed] = useState("7");
  const [backend, setBackend] = useState<"local" | "modal">("local");
  const [launching, setLaunching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [recent, setRecent] = useState<RunMeta[]>([]);
  useEffect(() => { refreshPersonas().catch(e => setError(String(e.message ?? e))).finally(() => setLoading(false)); }, [refreshPersonas]);
  useEffect(() => { api.runs().then(r => setRecent(r.slice(0, 5))).catch(() => {}); }, []);
  useEffect(() => {
    if (!personas.length || initialized.current) return;
    initialized.current = true;
    const defaults: Record<string, number> = {};
    for (const id of ["maya", "robert", "sam", "dana"]) if (state.personaConfigs[id]) defaults[id] = 1;
    if (!Object.keys(defaults).length) defaults[personas[0].id] = 1;
    setCounts(defaults);
  }, [personas, state.personaConfigs]);
  const selection = useMemo(() => personas.flatMap(p => Array.from({ length: counts[p.id] ?? 0 }, () => p.id)), [personas, counts]);
  const visible = personas.filter(p => `${p.name} ${p.bio} ${p.goal}`.toLowerCase().includes(query.trim().toLowerCase()));
  const budget = selection.reduce((s, id) => s + (state.personaConfigs[id]?.enforcement.step_budget ?? 100), 0);
  const estCost = budget * STEP_USD, estTpm = selection.length * TPM_PER_AGENT;
  const validSeed = seed.trim() !== "" && Number.isSafeInteger(Number(seed));
  const bump = (id: string, d: number) => setCounts(c => ({ ...c, [id]: Math.max(0, Math.min(12, (c[id] ?? 0) + d)) }));
  const launch = async () => {
    if (!selection.length || !validSeed) return;
    setLaunching(true); setError(null);
    try { const { runId } = await api.createRun({ personas: selection, seed: Number(seed), backend }); router.push(`/runs/${runId}`); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); setLaunching(false); }
  };
  return (
    <div className="workspace">
      <div className="page-heading"><div><p className="eyebrow !mt-0">Station Kepler</p><h1 className="mt-2">Set up a playtest</h1><p>Choose who will play, watch their sessions, and review what they find.</p></div><Link href="/runs" className="text-button">View previous playtests →</Link></div>
      <div className="launch-layout">
        <section className="panel overflow-hidden" aria-labelledby="testers-heading">
          <div className="section-heading"><div><h2 id="testers-heading">1. Choose your testers</h2><p>Different reading habits, experience levels, and approaches to play.</p></div><Link href="/personas" className="text-button">Manage library</Link></div>
          <div className="toolbar"><input type="search" value={query} onChange={e => setQuery(e.target.value)} className="search-field" placeholder="Search testers by name or background" aria-label="Search testers"/><button className="text-button" onClick={() => setCounts(Object.fromEntries(personas.map(p => [p.id, 1])))}>Select all</button><button className="text-button" onClick={() => setCounts({})}>Clear</button></div>
          {loading && !personas.length && <div className="flex items-center gap-3 p-6 text-muted"><Spinner/> Loading testers…</div>}
          {!loading && !personas.length && <div className="p-6 text-muted">{error ? "The tester library could not be loaded. Check the connection and try again." : "Your library is empty. Create a tester to start a playtest."}<Link href="/personas" className="text-button block mt-2">Open tester library →</Link></div>}
          {personas.length > 0 && !visible.length && <p className="p-8 text-muted">No testers match “{query}”. <button className="text-button" onClick={() => setQuery("")}>Clear search</button></p>}
          {visible.map(p => <PersonaRow key={p.id} p={p} count={counts[p.id] ?? 0} onBump={d => bump(p.id, d)}/>)}
          <div className="px-6 py-4 text-[12px] text-muted bg-panel2/40">{visible.length} of {personas.length} testers shown. Add multiple sessions for a tester to compare repeated attempts.</div>
        </section>
        <aside className="launch-summary" aria-label="Playtest summary">
          <div className="panel overflow-hidden">
            <div className="section-heading !px-5"><h2>2. Review & start</h2></div>
            <div className="summary-block"><h3>Selected testers <span className="text-muted font-normal">({selection.length} sessions)</span></h3><div className="space-y-3" aria-live="polite">
              {personas.filter(p => (counts[p.id] ?? 0) > 0).map(p => <span key={p.id} className="flex items-center gap-2.5 text-[14px]"><Avatar id={p.id} name={p.name} size={26}/><span className="flex-1">{p.name}</span><span className="text-muted text-[12px]">{counts[p.id]} session{counts[p.id] === 1 ? "" : "s"}</span></span>)}
              {!selection.length && <p>No testers selected. Add a tester from the list to continue.</p>}
            </div></div>
            <div className="summary-block"><div className="flex justify-between items-baseline"><span className="text-sm font-medium">Estimated cost</span><strong className="text-[26px] tracking-tight font-semibold">{usd(estCost)}</strong></div><p className="mt-2">Based on up to {budget.toLocaleString()} actions. Actual cost depends on how long each session runs.</p></div>
            <details className="summary-block advanced-settings"><summary>Run settings <span aria-hidden="true">⌄</span></summary><label>Game seed<input type="number" step={1} value={seed} onChange={e => setSeed(e.target.value)} className="search-field" aria-invalid={!validSeed}/></label><p className="mt-2">Use the same seed to repeat the game conditions.</p>{!validSeed && <p className="!text-danger" role="alert">Enter a whole number for the seed.</p>}<div className="mt-5 mb-2 text-[13px]">Run location</div><Segmented value={backend} options={["local", "modal"] as const} labels={{ local: "This computer", modal: "Cloud" }} onChange={setBackend}/><p className="mt-2">{backend === "local" ? "Sessions run on this computer." : "Sessions run in cloud sandboxes."}</p><dl className="detail-list mt-4"><div><dt>Estimated token use</dt><dd>{kTokens(estTpm)} / min</dd></div><div><dt>Available capacity</dt><dd>{kTokens(TPM_LIMIT)} / min</dd></div></dl>{estTpm > TPM_LIMIT && <p className="mt-2">Sessions above the available capacity will wait in a queue.</p>}</details>
            <div className="summary-block"><Button onClick={launch} disabled={!selection.length || launching || !validSeed} className="w-full !py-3">{launching && <Spinner className="!border-white !border-t-transparent"/>}{launching ? "Starting playtest…" : "Start playtest"}<span aria-hidden="true">→</span></Button><p className="mt-3 text-center">You’ll be taken to the live sessions.</p>{error && <p className="mt-3 !text-danger" role="alert">{error}</p>}</div>
          </div>
          <div className="mt-5 px-1"><h3 className="text-[13px] font-semibold mb-2">What happens next</h3><ol className="text-[13px] leading-7 text-muted list-decimal pl-4"><li>Testers play independently.</li><li>Watch progress and inspect any session.</li><li>Review findings and supporting evidence.</li></ol></div>
        </aside>
      </div>
      {!!recent.length && <section className="mt-10" aria-labelledby="recent-heading"><div className="flex justify-between items-center mb-4"><h2 id="recent-heading" className="font-semibold text-lg">Recent playtests</h2><Link href="/runs" className="text-button">View all →</Link></div><div className="panel overflow-x-auto"><table className="data-table"><thead><tr>{["Playtest", "Status", "Sessions", "Started", ""].map((h,i) => <th key={i} scope="col">{h || <span className="sr-only">Actions</span>}</th>)}</tr></thead><tbody>{recent.map(r => <tr key={r.runId}><td className="font-medium break-all">{r.runId}</td><td><Tag tone={r.status === "running" ? "ok" : r.status === "failed" ? "danger" : "muted"}>{r.status}</Tag></td><td>{r.personas.length}</td><td className="whitespace-nowrap text-muted">{relTime(r.startedAt)}</td><td className="whitespace-nowrap"><Link href={`/runs/${r.runId}`} className="text-info mr-5">Open sessions</Link><Link href={`/runs/${r.runId}/report`} className="text-info">View report</Link></td></tr>)}</tbody></table></div></section>}
    </div>
  );
}
function PersonaRow({ p, count, onBump }: { p: PersonaConfig; count: number; onBump: (d: number) => void }) {
  const e = p.enforcement;
  return <article className={`tester-row ${count ? "selected" : ""}`}><div className="tester-main"><Avatar id={p.id} name={p.name} size={36}/><div><h3>{p.name}<small>Age {p.age}</small></h3><p>{p.bio}</p><div className="tester-traits"><span><b>{familiarity[e.genre_familiarity]}</b></span><span>{reading[e.reading]}</span><span>{e.audio === "on" ? "Sound on" : "Sound off"}</span></div></div><div className="stepper"><button type="button" onClick={() => onBump(-1)} disabled={!count} aria-label={`Remove a session for ${p.name}`}>−</button><output aria-label={`Sessions for ${p.name}`}>{count}</output><button type="button" onClick={() => onBump(1)} disabled={count >= 12} aria-label={`Add a session for ${p.name}`}>+</button></div></div><details className="tester-more"><summary>Goal & testing settings</summary><p><strong>Goal:</strong> {p.goal}</p><dl className="detail-list"><div><dt>Exploration</dt><dd className="capitalize">{e.exploration}</dd></div><div><dt>Patience</dt><dd>{e.patience} steps without progress</dd></div><div><dt>Maximum actions</dt><dd>{e.step_budget}</dd></div><div><dt>Reasoning effort</dt><dd className="capitalize">{e.reasoning_effort}</dd></div></dl></details></article>;
}
