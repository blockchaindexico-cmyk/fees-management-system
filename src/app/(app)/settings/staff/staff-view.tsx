"use client";

import { useApi } from "@/lib/api/hooks";
import { fmtDate } from "@/lib/format";
import type { StaffMember } from "@/lib/types";
import { useApp } from "@/components/layout/app-shell";
import { Pending } from "@/components/ui/page-state";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import { IconTile, type TileColor } from "@/components/ui/kpi";
import { Ban, Calculator, Crown, Eye, GraduationCap, type LucideIcon } from "lucide-react";
import { AddStaffForm, PasswordForm, RoleForm } from "./staff-forms";

const ROLE_HELP: { role: string; title: string; text: string; icon: LucideIcon; color: TileColor }[] = [
  { role: "admin", title: "Owner / Director", text: "Everything, including settings and staff.", icon: Crown, color: "indigo" },
  { role: "accountant", title: "Accountant", text: "Collects fees, edits students and fees, calls parents.", icon: Calculator, color: "green" },
  { role: "principal", title: "Principal / caller", text: "Sees dashboards and reports; calls parents from the daily list. Cannot change fees.", icon: Eye, color: "blue" },
  { role: "teacher", title: "Teacher", text: "Coming later · no access yet.", icon: GraduationCap, color: "orange" },
  { role: "none", title: "No access", text: "Can sign in but sees nothing.", icon: Ban, color: "gray" },
];

function fmtWhen(iso: string | null | undefined, tz: string) {
  if (!iso) return "Never";
  return new Date(iso).toLocaleString("en-IN", { timeZone: tz, day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });
}

export function StaffView() {
  const { viewer, settings } = useApp();
  const res = useApi<StaffMember[]>("/api/staff", { refreshInterval: 0 });
  if (!res.data) return <Pending queries={[res]} />;
  const profiles = res.data;
  const tz = settings.timezone ?? "Asia/Kolkata";
  const waiting = profiles.filter((p) => !p.role).length;

  return (
    <>
      <PageHeader
        title="Staff & roles"
        description="Who can sign in, and what they can do."
        info="New logins get no access until you give them a role."
      />

      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Card
          title="Staff logins"
          description={
            waiting > 0
              ? `${waiting} ${waiting === 1 ? "login is" : "logins are"} waiting for a role.`
              : `${profiles.length} ${profiles.length === 1 ? "login" : "logins"}`
          }
        >
          <div className="-mx-5 overflow-x-auto sm:-mx-6">
            <table className="w-full min-w-[640px] border-collapse text-left text-subhead">
              <thead className="text-caption font-medium text-muted">
                <tr className="border-b border-line">
                  <th scope="col" className="py-2 pl-5 pr-3 font-medium sm:pl-6">Name</th>
                  <th scope="col" className="px-3 py-2 font-medium">Role</th>
                  <th scope="col" className="px-3 py-2 font-medium">Added</th>
                  <th scope="col" className="py-2 pl-3 pr-5 font-medium sm:pr-6">Last sign-in</th>
                </tr>
              </thead>
              <tbody>
                {profiles.map((p) => (
                  <tr key={p.id} className="border-b border-line last:border-0">
                    <td className="py-3 pl-5 pr-3 sm:pl-6">
                      <span className="flex items-center gap-3">
                        <Avatar name={p.full_name || p.email || "?"} />
                        <span className="min-w-0">
                          <span className="flex flex-wrap items-center gap-1.5 font-medium text-ink">
                            {p.full_name || "—"}
                            {!p.role && <Badge tone="warning">needs a role</Badge>}
                          </span>
                          <span className="block truncate text-caption text-muted">{p.email}</span>
                          <PasswordForm id={p.id} isSelf={p.id === viewer.id} />
                        </span>
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      <RoleForm key={p.id} id={p.id} role={p.role} isSelf={p.id === viewer.id} />
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-ink-2">{fmtDate(p.created_at)}</td>
                    <td className="whitespace-nowrap py-3 pl-3 pr-5 text-ink-2 sm:pr-6">{fmtWhen(p.last_sign_in_at, tz)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <div className="space-y-4">
          <Card title="Add staff login">
            <AddStaffForm />
          </Card>

          <Card title="Roles">
            <ul className="space-y-3.5">
              {ROLE_HELP.map((r) => (
                <li key={r.role} className="flex items-center gap-3">
                  <IconTile icon={r.icon} color={r.color} />
                  <span className="min-w-0">
                    <span className="block text-subhead font-medium text-ink">{r.title}</span>
                    <span className="block text-footnote text-ink-2">{r.text}</span>
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </>
  );
}
