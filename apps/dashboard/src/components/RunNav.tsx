"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
export function RunNav({ runId }: { runId: string }) {
  const path = usePathname(), base = `/runs/${runId}`;
  return <nav className="run-tabs" aria-label="Playtest navigation">{[{ href: base, label: "Sessions" }, { href: `${base}/report`, label: "Report & findings" }, { href: `${base}/analyst`, label: "Ask about this playtest" }].map(n => <Link key={n.href} href={n.href} aria-current={path === n.href ? "page" : undefined}>{n.label}</Link>)}</nav>;
}
