"use client";

import { useEffect, useMemo, useState } from "react";
import type { PersonaConfig } from "@/lib/contract";
import { useFleet } from "@/lib/fleet-store";
import { DEFAULT_PERSONA } from "@/lib/enforcement";
import { Avatar, Button, Tag } from "@/components/ui";
import { PersonaForm } from "./PersonaForm";

const SEEDS = new Set(["maya", "robert", "sam", "priya", "dana"]);

export function PersonasView() {
  const { state, refreshPersonas } = useFleet();
  const personas = useMemo(() => Object.values(state.personaConfigs), [state.personaConfigs]);
  const [draft, setDraft] = useState<PersonaConfig>(DEFAULT_PERSONA);
  const [basedOn, setBasedOn] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => { refreshPersonas().catch(() => {}); }, [refreshPersonas]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  const startFrom = (p: PersonaConfig) => {
    setBasedOn(p.id);
    setDraft({ ...p, id: `${p.id}-2`, name: p.name, enforcement: { ...p.enforcement } });
  };
  const startBlank = () => { setBasedOn(null); setDraft(DEFAULT_PERSONA); };

  return (
    <div className="workspace grid grid-cols-1 lg:grid-cols-12 gap-8">
      <section className="lg:col-span-4">
        <p className="eyebrow">roster · {personas.length}</p>
        <h1 className="display mt-1 text-[28px]">Tester library</h1>
        <p className="mt-1 text-[14px] text-muted">Review tester profiles. Select a profile to create a new tester based on it.</p>
        <Button variant="outline" onClick={startBlank} className="mt-3 w-full">+ New persona</Button>
        <ul className="mt-3  space-y-2 overflow-y-auto pr-1" data-persona-list>
          {personas.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => startFrom(p)}
                className={`panel flex w-full items-start gap-3 p-3 text-left transition-colors hover:bg-panel2 ${basedOn === p.id ? "ring-1 ring-amber/60 bg-panel2" : ""}`}
              >
                <Avatar id={p.id} name={p.name} size={36} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline gap-2">
                    <span className="display text-[17px]">{p.name}</span>
                    <span className="text-[12px] text-dim">{p.age}</span>
                    {!SEEDS.has(p.id) && <Tag tone="amber">custom</Tag>}
                  </span>
                  <span className="mt-0.5 block text-[14px] leading-relaxed text-muted">{p.bio}</span>
                  <span className="mt-1.5 flex flex-wrap gap-1">
                    <Tag>{p.enforcement.reading}</Tag>
                    <Tag>{p.enforcement.genre_familiarity} experience</Tag>
                    <Tag tone={p.enforcement.audio === "off" ? "danger" : "muted"}>{p.enforcement.audio === "off" ? "sound off" : "sound on"}</Tag>
                    <Tag>Patience: {p.enforcement.patience}</Tag>
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="lg:col-span-8" style={{ animationDelay: "100ms" }}>
        <p className="eyebrow">{basedOn ? `new persona · based on ${basedOn}` : "new persona"}</p>
        <h2 className="display mt-1 text-[28px]">Define a tester profile</h2>
        <PersonaForm
          key={basedOn ?? "blank"}
          value={draft}
          onChange={setDraft}
          onSaved={async (p) => {
            await refreshPersonas();
            setToast(`Saved ${p.name} (${p.id}). It's now selectable in the fleet launcher.`);
            setBasedOn(null);
            setDraft(DEFAULT_PERSONA);
          }}
        />
      </section>

      {toast && (
        <div className="fixed bottom-5 right-5 z-50 rise rounded-lg bg-amber px-4 py-3 text-[15px] font-semibold text-white shadow-xl" data-toast role="status">{toast}</div>
      )}
    </div>
  );
}
