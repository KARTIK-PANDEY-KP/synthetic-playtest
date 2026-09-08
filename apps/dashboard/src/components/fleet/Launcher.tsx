"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import type { PersonaConfig, RunMeta } from "@/lib/contract";
import { useFleet } from "@/lib/fleet-store";
import { kTokens, relTime, usd } from "@/lib/format";
import { Avatar, Button, Segmented, Spinner, Tag } from "@/components/ui";

const STEP_USD = 0.117;
const TPM_PER_AGENT = 62_000;
const TPM_LIMIT = 500_000;

export function Launcher() {
  const router = useRouter();
  const { state, refreshPersonas } = useFleet();
  const personas = useMemo(() => Object.values(state.personaConfigs), [state.personaConfigs]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [seed, setSeed] = useState(7);
  const [backend, setBackend] = useState<"local" | "modal">("local");
  const [launching, setLaunching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recent, setRecent] = useState<RunMeta[]>([]);

  useEffect(() => { refreshPersonas().catch((e) => setError(String(e.message ?? e))); }, [refreshPersonas]);
  useEffect(() => {
    api.runs().then((r) => setRecent(r.slice(0, 5))).catch(() => {});
  }, []);

  // default: the classic 4-persona demo fleet once personas arrive
  useEffect(() => {
    if (personas.length && Object.keys(counts).length === 0) {
      const def: Record<string, number> = {};
      for (const id of ["maya", "robert", "sam", "dana"]) if (state.personaConfigs[id]) def[id] = 1;
      if (Object.keys(def).length === 0) def[personas[0].id] = 1;
      setCounts(def);
    }
  }, [personas, counts, state.personaConfigs]);

  const selection = useMemo(() => {
    const out: string[] = [];
    for (const p of personas) for (let i = 0; i < (counts[p.id] ?? 0); i++) out.push(p.id);
    return out;
  }, [counts, personas]);

  const budget = selection.reduce((s, id) => s + (state.personaConfigs[id]?.enforcement.step_budget ?? 100), 0);
  const estCost = budget * STEP_USD;
  const estTpm = selection.length * TPM_PER_AGENT;
  const over = estTpm > TPM_LIMIT;

  const bump = (id: string, d: number) => setCounts((c) => ({ ...c, [id]: Math.max(0, Math.min(12, (c[id] ?? 0) + d)) }));

  const launch = async () => {
    if (!selection.length) return;
    setLaunching(true);
    setError(null);
    try {
      const { runId } = await api.createRun({ personas: selection, seed, backend });
      router.push(`/runs/${runId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setLaunching(false);
    }
  };

  return (
    <div className="mx-auto grid h-full max-w-[1240px] grid-cols-12 gap-6 px-6 py-6">
      {/* roster */}
      <section className="col-span-7 rise">
        <p className="eyebrow">01 — assemble the fleet</p>
        <h1 className="display mt-1 text-[36px] text-balance">
          Who plays <span className="text-amber2">Station Kepler</span> tonight?
        </h1>
        <p className="mt-1.5 max-w-2xl text-[14.5px] text-muted">
          Each tester is a person the harness makes real: redacted screenshots, missing tools, a patience gate measured from telemetry. Add the same person twice to see if they agree with themselves.
        </p>

        <div className="mt-4 grid grid-cols-2 gap-2.5">
          {personas.map((p, i) => (
            <PersonaRow key={p.id} p={p} count={counts[p.id] ?? 0} onBump={(d) => bump(p.id, d)} delay={i * 60} />
          ))}
          {!personas.length && (
            <div className="col-span-2 panel flex items-center gap-3 p-6 text-muted"><Spinner /> loading personas from the orchestrator…</div>
          )}
          <Link href="/personas" className="panel flex items-center justify-between px-4 py-3 text-[14px] text-muted transition-colors hover:text-fg">
            <span>Need someone else? <span className="text-fg">Create a persona</span> — unlimited.</span>
            <span className="font-mono text-amber2">→</span>
          </Link>
        </div>
      </section>

      {/* launch */}
      <aside className="col-span-5 rise" style={{ animationDelay: "120ms" }}>
        <p className="eyebrow">02 — launch</p>
        <div className="panel mt-3 overflow-hidden">
          <div className="border-b border-line p-5">
            <div className="flex flex-wrap gap-1.5">
              {selection.length ? selection.map((id, i) => {
                const p = state.personaConfigs[id];
                return (
                  <span key={`${id}-${i}`} className="inline-flex items-center gap-1.5 rounded-full bg-panel2 py-1 pl-1 pr-3 text-[14px] ring-1 ring-line">
                    <Avatar id={id} name={p?.name ?? id} size={22} /> {p?.name ?? id}
                  </span>
                );
              }) : <span className="text-[15px] text-dim">No testers selected.</span>}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 border-b border-line p-5">
            <label className="block">
              <span className="eyebrow">seed</span>
              <input
                type="number"
                value={seed}
                onChange={(e) => setSeed(Number(e.target.value))}
                className="readout mt-1 w-full rounded-lg bg-panel2 px-3 py-2 text-[18px] text-fg ring-1 ring-line outline-none focus:ring-amber"
              />
            </label>
            <div>
              <span className="eyebrow">backend</span>
              <div className="mt-1"><Segmented value={backend} options={["local", "modal"] as const} onChange={setBackend} /></div>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3 border-b border-line p-5">
            <Stat label="agents" value={String(selection.length)} />
            <Stat label="est. cost" value={usd(estCost, 0)} sub={`${budget} steps × $0.117`} />
            <Stat label="est. tpm" value={kTokens(estTpm)} sub={over ? `over ${kTokens(TPM_LIMIT)} — governor queues` : `of ${kTokens(TPM_LIMIT)} tier-1`} warn={over} />
          </div>

          <div className="p-5">
            <Button onClick={launch} disabled={!selection.length || launching} className="w-full !py-3 !text-[17px]">
              {launching ? <Spinner className="!border-ink !border-t-transparent" /> : null}
              {launching ? "Launching sandboxes…" : `Launch ${selection.length || ""} ${selection.length === 1 ? "agent" : "agents"}`}
            </Button>
            {error && <p className="mt-3 text-[14px] text-danger">{error}</p>}
          </div>
        </div>

        {recent.length > 0 && (
          <div className="mt-5">
            <p className="eyebrow">recent runs</p>
            <ul className="mt-2 divide-y divide-line rounded-xl ring-1 ring-line">
              {recent.map((r) => (
                <li key={r.runId} className="flex items-center gap-3 px-4 py-2.5 text-[14px]">
                  <span className={`h-2 w-2 rounded-full ${r.status === "running" ? "bg-ok live-dot" : r.status === "done" ? "bg-amber" : "bg-dim"}`} />
                  <span className="font-medium">{r.runId}</span>
                  <span className="text-dim">{r.personas.length} agents · seed {r.seed} · {r.backend}</span>
                  <span className="ml-auto text-dim">{relTime(r.startedAt)}</span>
                  <Link href={`/runs/${r.runId}`} className="text-info hover:underline">live</Link>
                  <Link href={`/runs/${r.runId}/report`} className="text-amber2 hover:underline">report</Link>
                </li>
              ))}
            </ul>
          </div>
        )}
      </aside>
    </div>
  );
}

function Stat({ label, value, sub, warn }: { label: string; value: string; sub?: string; warn?: boolean }) {
  return (
    <div>
      <span className="eyebrow">{label}</span>
      <span className={`readout mt-0.5 block text-[24px] ${warn ? "text-danger" : "text-fg"}`}>{value}</span>
      {sub && <span className={`block text-[12px] ${warn ? "text-danger" : "text-dim"}`}>{sub}</span>}
    </div>
  );
}

function PersonaRow({ p, count, onBump, delay }: { p: PersonaConfig; count: number; onBump: (d: number) => void; delay: number }) {
  const e = p.enforcement;
  const on = count > 0;
  return (
    <div
      className={`panel rise relative flex gap-3 p-3 transition-colors ${on ? "ring-1 ring-amber/50 bg-panel2" : ""}`}
      style={{ animationDelay: `${delay}ms` }}
    >
      <Avatar id={p.id} name={p.name} size={40} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="display text-[18px]">{p.name}</span>
          <span className="text-[12.5px] text-dim">{p.age}</span>
        </div>
        <p className="mt-0.5 truncate text-[13px] leading-snug text-muted" title={p.bio}>{p.bio}</p>
        <div className="mt-1.5 flex flex-wrap gap-1">
          <Tag>{e.reading}</Tag>
          <Tag>{e.genre_familiarity === "none" ? "no conventions" : `${e.genre_familiarity} conv.`}</Tag>
          <Tag tone={e.audio === "off" ? "danger" : "muted"}>{e.audio === "off" ? "sound off" : "sound on"}</Tag>
          <Tag>patience {e.patience}</Tag>
        </div>
      </div>
      <div className="flex items-center gap-1.5">
        <button type="button" onClick={() => onBump(-1)} className="grid h-8 w-8 place-items-center rounded-md bg-panel3 text-[18px] leading-none ring-1 ring-line2 hover:bg-panel2 disabled:opacity-30" disabled={!on} aria-label={`remove ${p.name}`}>−</button>
        <span className={`readout w-6 text-center text-[20px] ${on ? "text-amber2" : "text-dim"}`}>{count}</span>
        <button type="button" onClick={() => onBump(1)} className="grid h-8 w-8 place-items-center rounded-md bg-panel3 text-[18px] leading-none ring-1 ring-line2 hover:bg-amber hover:text-ink" aria-label={`add ${p.name}`}>+</button>
      </div>
    </div>
  );
}
