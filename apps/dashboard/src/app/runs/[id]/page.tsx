"use client";

import { useParams } from "next/navigation";
import { LiveRun } from "@/components/fleet/LiveRun";

export default function RunPage() {
  const { id } = useParams<{ id: string }>();
  return <LiveRun runId={id} />;
}
