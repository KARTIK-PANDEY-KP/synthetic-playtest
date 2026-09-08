"use client";
import { useEffect, useRef } from "react";
/** Keep keyboard focus inside an open dialog and return it to its trigger. */
export function useDialogFocus() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const root = ref.current;
    root?.querySelector<HTMLElement>("button, a[href], input, select, [tabindex='0']")?.focus();
    const trap = (e: KeyboardEvent) => {
      if (e.key !== "Tab" || !root) return;
      const items = [...root.querySelectorAll<HTMLElement>("button:not(:disabled), a[href], input:not(:disabled), select, summary, [tabindex='0']")].filter(el => el.getClientRects().length > 0);
      if (!items.length) { e.preventDefault(); root.focus(); return; }
      const first = items[0], last = items[items.length - 1];
      if (e.shiftKey && (document.activeElement === first || !root.contains(document.activeElement))) { e.preventDefault(); last.focus(); }
      if (!e.shiftKey && (document.activeElement === last || !root.contains(document.activeElement))) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", trap);
    return () => { document.body.style.overflow = overflow; document.removeEventListener("keydown", trap); if (previous?.isConnected) previous.focus(); };
  }, []);
  return ref;
}
