"use client";

import { useMemo, useState } from "react";
import { api } from "@/lib/api";
import type { PersonaConfig, ReadingLevel, Familiarity, Exploration, ReasoningEffort } from "@/lib/contract";
import { describeEnforcement, slugify, validatePersona } from "@/lib/enforcement";
import { Avatar, Button, Segmented, Spinner } from "@/components/ui";

export function PersonaForm({ value, onChange, onSaved }: { value: PersonaConfig; onChange: (p: PersonaConfig) => void; onSaved: (p: PersonaConfig) => void | Promise<void> }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showJson, setShowJson] = useState(false);
  const [idTouched, setIdTouched] = useState(false);
  const errors = useMemo(() => validatePersona(value), [value]);
  const preview = useMemo(() => describeEnforcement({ ...value, name: value.name || "This tester" }), [value]);

  const set = <K extends keyof PersonaConfig>(k: K, v: PersonaConfig[K]) => onChange({ ...value, [k]: v });
  const setE = <K extends keyof PersonaConfig["enforcement"]>(k: K, v: PersonaConfig["enforcement"][K]) => onChange({ ...value, enforcement: { ...value.enforcement, [k]: v } });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (errors.length) { setError(errors[0]); return; }
    setSaving(true);
    setError(null);
    try {
      const saved = await api.createPersona(value);
      await onSaved(saved);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const e = value.enforcement;

  return (
    <form onSubmit={submit} className="mt-3 grid grid-cols-12 gap-4" data-persona-form>
      {/* preview — always visible, changes with every slider */}
      <div className="col-span-12 rounded-xl border border-amber/30 bg-amber/5 px-5 py-3.5" data-preview>
        <p className="eyebrow text-amber2">How {value.name.split(" ")[0] || "this tester"} will experience the game</p>
        <p className="mt-1.5 text-[15px] leading-relaxed text-fg">
          {preview.map((s, i) => <span key={i}>{s} </span>)}
        </p>
      </div>

      {/* identity */}
      <div className="col-span-12 xl:col-span-6 panel p-5">
        <p className="eyebrow">Profile</p>
        <div className="mt-3 flex items-center gap-3">
          <Avatar id={value.id || "new"} name={value.name || "?"} size={44} />
          <label className="flex-1">
            <span className="eyebrow !text-[10px]">name</span>
            <input
              value={value.name}
              onChange={(ev) => {
                const name = ev.target.value;
                onChange({ ...value, name, id: idTouched ? value.id : slugify(name) });
              }}
              placeholder="Dana Kim"
              className="mt-0.5 w-full rounded-lg bg-panel2 px-3 py-2 text-[17px] text-fg ring-1 ring-line outline-none placeholder:text-dim focus:ring-amber"
              name="name"
            />
          </label>
          <label className="w-20">
            <span className="eyebrow !text-[10px]">age</span>
            <input type="number" value={value.age} onChange={(ev) => set("age", Number(ev.target.value))} className="readout mt-0.5 w-full rounded-lg bg-panel2 px-3 py-2 text-[17px] text-fg ring-1 ring-line outline-none focus:ring-amber" name="age" />
          </label>
        </div>
        <label className="mt-3 block">
          <span className="eyebrow !text-[10px]">id <span className="normal-case tracking-normal text-dim">— file name, lowercase</span></span>
          <input value={value.id} onChange={(ev) => { setIdTouched(true); set("id", ev.target.value); }} placeholder="dana" className="mt-0.5 w-full rounded-lg bg-panel2 px-3 py-2 font-mono text-[14px] text-fg ring-1 ring-line outline-none placeholder:text-dim focus:ring-amber" name="id" />
        </label>
        <label className="mt-3 block">
          <span className="eyebrow !text-[10px]">Background <span className="normal-case tracking-normal text-dim">— habits, preferences, and experience</span></span>
          <textarea
            value={value.bio}
            onChange={(ev) => set("bio", ev.target.value)}
            rows={3}
            placeholder="Plays on the bus with the sound off, always. She has never heard a single audio cue in any game she owns and does not think of this as a limitation."
            className="mt-0.5 w-full resize-y rounded-lg bg-panel2 px-3 py-2 text-[15px] leading-relaxed text-fg ring-1 ring-line outline-none placeholder:text-dim focus:ring-amber"
            name="bio"
          />
        </label>
        <label className="mt-3 block">
          <span className="eyebrow !text-[10px]">goal</span>
          <input value={value.goal} onChange={(ev) => set("goal", ev.target.value)} placeholder="Make progress without ever turning the volume on." className="mt-0.5 w-full rounded-lg bg-panel2 px-3 py-2 text-[15px] text-fg ring-1 ring-line outline-none placeholder:text-dim focus:ring-amber" name="goal" />
        </label>
      </div>

      {/* enforcement */}
      <div className="col-span-12 xl:col-span-6 panel p-5">
        <p className="eyebrow">Testing behavior</p>
        <div className="mt-3 space-y-3">
          <Field label="reading" hint="words visible per text region before pixels are blurred">
            <Segmented<ReadingLevel> value={e.reading} options={["skim", "normal", "thorough"]} onChange={(v) => setE("reading", v)} />
          </Field>
          <Field label="genre familiarity" hint="how familiar the tester is with common game controls">
            <Segmented<Familiarity> value={e.genre_familiarity} options={["none", "medium", "high"]} onChange={(v) => setE("genre_familiarity", v)} />
          </Field>
          <Field label="patience" hint="no-progress steps before frustration escalates">
            <div className="flex items-center gap-3">
              <input type="range" min={1} max={15} value={e.patience} onChange={(ev) => setE("patience", Number(ev.target.value))} className="flex-1" name="patience" />
              <span className="readout w-10 text-right text-[22px] text-amber2">{e.patience}</span>
            </div>
          </Field>
          <Field label="exploration" hint="how much the tester looks beyond the main objective">
            <Segmented<Exploration> value={e.exploration} options={["low", "medium", "high"]} onChange={(v) => setE("exploration", v)} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="audio" hint="whether the tester can hear the game">
              <Segmented<"on" | "off"> value={e.audio} options={["on", "off"]} onChange={(v) => setE("audio", v)} />
            </Field>
            <Field label="step budget" hint="hard cap">
              <input type="number" min={10} max={400} step={10} value={e.step_budget} onChange={(ev) => setE("step_budget", Number(ev.target.value))} className="readout w-full rounded-lg bg-panel2 px-3 py-1.5 text-[17px] text-fg ring-1 ring-line outline-none focus:ring-amber" name="step_budget" />
            </Field>
          </div>
          <Field label="reasoning effort" hint="how much time the tester spends deciding what to do">
            <Segmented<ReasoningEffort> value={e.reasoning_effort} options={["low", "medium", "high"]} onChange={(v) => setE("reasoning_effort", v)} />
          </Field>
        </div>
      </div>

      <div className="col-span-12 flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={saving} className="!px-6 !py-2.5 !text-[16px]">
          {saving && <Spinner className="!border-ink !border-t-transparent" />}
          {saving ? "Saving…" : "Create persona"}
        </Button>
        <Button variant="ghost" onClick={() => setShowJson((s) => !s)}>{showJson ? "Hide" : "Show"} configuration JSON</Button>
        {errors.length > 0 && <span className="text-[13px] text-dim">{errors.length} field{errors.length === 1 ? "" : "s"} to complete: {errors[0]}</span>}
        {error && <span className="text-[14px] text-danger">{error}</span>}
      </div>

      {showJson && (
        <pre className="col-span-12 overflow-x-auto rounded-xl bg-panel2 p-4 font-mono text-[12.5px] leading-relaxed text-muted ring-1 ring-line">{JSON.stringify(value, null, 2)}</pre>
      )}
    </form>
  );
}

function Field({ label, hint, children }: { label: string; hint: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="shrink-0 whitespace-nowrap text-[14px] font-semibold">{label}</span>
        <span className="text-[12px] leading-relaxed text-dim" title={hint}>{hint}</span>
      </div>
      <div className="mt-1">{children}</div>
    </div>
  );
}
