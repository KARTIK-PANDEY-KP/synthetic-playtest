"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { PRESET_QUESTIONS } from "@/lib/contract";
import { Markdown } from "@/components/Markdown";
import { Button, Spinner } from "@/components/ui";

type Turn = { q: string; a?: string; error?: string; ms?: number };

/** Three preset questions are the primary affordance; free text is secondary and small. */
export function Analyst({ runId }: { runId: string }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const [free, setFree] = useState("");

  const ask = async (q: string) => {
    if (!q.trim() || busy) return;
    setBusy(true);
    const t0 = performance.now();
    setTurns((t) => [{ q }, ...t]);
    try {
      const { answer } = await api.ask(runId, q);
      setTurns((t) => t.map((x, i) => (i === 0 ? { ...x, a: answer, ms: performance.now() - t0 } : x)));
    } catch (e) {
      setTurns((t) => t.map((x, i) => (i === 0 ? { ...x, error: e instanceof Error ? e.message : String(e) } : x)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div data-analyst>
      <div className="grid grid-cols-3 gap-3">
        {PRESET_QUESTIONS.map((q, i) => (
          <button
            key={q}
            type="button"
            disabled={busy}
            onClick={() => ask(q)}
            data-preset={i + 1}
            className="group panel relative flex min-h-[112px] flex-col justify-between p-4 text-left transition-all hover:bg-panel2 hover:ring-1 hover:ring-amber/60 disabled:opacity-50"
          >
            <span className="readout text-[12px] text-amber2">Q{i + 1}</span>
            <span className="display text-[18px] leading-tight text-fg">{q}</span>
            <span className="absolute bottom-3 right-3 font-mono text-[14px] text-dim transition-transform group-hover:translate-x-0.5 group-hover:text-amber2">→</span>
          </button>
        ))}
      </div>

      <div className="mt-5 space-y-4">
        {turns.map((t, i) => (
          <div key={i} className="panel overflow-hidden rise">
            <div className="flex items-center gap-3 border-b border-line bg-panel2/60 px-5 py-3">
              <span className="eyebrow">asked</span>
              <span className="text-[15px] font-medium">{t.q}</span>
              {t.ms && <span className="ml-auto readout text-[12px] text-dim">{(t.ms / 1000).toFixed(1)}s · gpt-6-astra · all reports in context</span>}
            </div>
            <div className="px-5 py-4" data-answer>
              {!t.a && !t.error && (
                <div className="flex items-center gap-3 text-muted"><Spinner /> reading {"all"} reports, clustered findings and telemetry…</div>
              )}
              {t.error && <p className="text-danger">{t.error}</p>}
              {t.a && <Markdown text={t.a} className="text-[15.5px]" />}
            </div>
          </div>
        ))}
      </div>

      <form
        onSubmit={(e) => { e.preventDefault(); ask(free); setFree(""); }}
        className="mt-6 flex items-center gap-2 border-t border-line pt-4"
      >
        <input
          value={free}
          onChange={(e) => setFree(e.target.value)}
          placeholder="…or ask something specific (e.g. why did Robert stall at the vent?)"
          className="flex-1 rounded-lg bg-panel2 px-3 py-2 text-[14px] text-fg ring-1 ring-line outline-none placeholder:text-dim focus:ring-amber"
        />
        <Button type="submit" variant="outline" disabled={busy || !free.trim()} className="!py-2 !text-[14px]">Ask</Button>
      </form>
    </div>
  );
}
