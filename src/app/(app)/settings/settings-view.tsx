"use client";

import Link from "next/link";
import { useApi } from "@/lib/api/hooks";
import type { SchoolSettings } from "@/lib/types";
import { Pending } from "@/components/ui/page-state";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { AllocationRuleForm, CallRulesForm, SchoolProfileForm } from "./settings-forms";

export function SettingsView() {
  const res = useApi<SchoolSettings>("/api/settings", { refreshInterval: 0 });
  if (!res.data) return <Pending queries={[res]} />;
  const settings = res.data;

  return (
    <>
      <PageHeader
        title="School settings"
        description="Receipt details, how payments are applied and who is on the daily call list."
        info="Only the owner / admin can change these."
      />
      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
        <SchoolProfileForm settings={settings} />
        <div className="space-y-4">
          <AllocationRuleForm current={settings.allocation_order} />
          <CallRulesForm settings={settings} />
          <Card title="Time zone">
            <p className="text-footnote text-ink-2">
              Dates such as &ldquo;today&rdquo;, overdue status and month boundaries use <b>{settings.timezone}</b>. Sessions, installments
              and fee amounts are managed under{" "}
              <Link href="/setup" className="font-medium text-accent hover:underline">
                Setup
              </Link>
              .
            </p>
          </Card>
        </div>
      </div>
    </>
  );
}
