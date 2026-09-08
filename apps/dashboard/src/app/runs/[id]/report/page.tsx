"use client";

import { useParams } from "next/navigation";
import { ReportView } from "@/components/report/ReportView";

export default function ReportPage() {
  const { id } = useParams<{ id: string }>();
  return <ReportView runId={id} />;
}
