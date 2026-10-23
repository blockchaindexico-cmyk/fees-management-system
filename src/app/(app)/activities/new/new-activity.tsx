"use client";

import { todayIST } from "@/lib/format";
import { RequireRole } from "@/components/layout/app-shell";
import { PageHeader } from "@/components/ui/page-header";
import { ActivityForm } from "../activity-form";

export function NewActivity() {
  return (
    <RequireRole role="writer">
      <PageHeader
        title="New student activity"
        crumbs={[{ label: "Activities", href: "/activities" }, { label: "New" }]}
        description="Something the school does for students that also helps bring the fees in."
        info="For example extra English practice for students who need it, or a class trip open to students whose fees are paid. The accountant ticks, at the fee counter, which payments came in because of it."
      />
      <ActivityForm today={todayIST()} />
    </RequireRole>
  );
}
