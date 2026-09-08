"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import type { SessionEvent } from "@/lib/contract";

const MAX = 1200;

/** Live SSE of SessionEvents for one persona (history replayed first by the server). */
export function useSession(runId: string | undefined, persona: string | undefined, enabled = true) {
  const [events, setEvents] = useState<SessionEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const buf = useRef<SessionEvent[]>([]);
  const flush = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!runId || !persona || !enabled) return;
    buf.current = [];
    setEvents([]);
    const es = new EventSource(api.streamUrl(runId, persona));
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    es.onmessage = (m) => {
      try {
        buf.current.push(JSON.parse(m.data) as SessionEvent);
      } catch { return; }
      if (!flush.current) {
        flush.current = setTimeout(() => {
          flush.current = null;
          setEvents((prev) => {
            const next = prev.concat(buf.current);
            buf.current = [];
            return next.length > MAX ? next.slice(next.length - MAX) : next;
          });
        }, 120);
      }
    };
    return () => {
      es.close();
      if (flush.current) { clearTimeout(flush.current); flush.current = null; }
      setConnected(false);
    };
  }, [runId, persona, enabled]);

  return { events, connected };
}
