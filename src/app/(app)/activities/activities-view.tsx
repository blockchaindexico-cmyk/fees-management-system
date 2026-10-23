"use client";

import Link from "next/link";
import { HandCoins, Plus, Sparkles, Users, Wallet } from "lucide-react";
import { useApi } from "@/lib/api/hooks";
import { type SearchParams, param } from "@/lib/context";
import { fmtDate, fmtDateShort, num, pct, ratioPct, rupeesShort } from "@/lib/format";
import { PARTICIPANT_LABELS, PARTICIPANT_RESPONSES, VERDICT_LABELS } from "@/lib/recovery";
import type { ActivitiesOverview, ActivitySummary } from "@/lib/types";
import { useApp } from "@/components/layout/app-shell";
import { Pending } from "@/components/ui/page-state";
import { PageHeader } from "@/components/ui/page-header";
import { Segmented, withParams } from "@/components/ui/segmented";
import { Card } from "@/components/ui/card";
import { Kpi } from "@/components/ui/kpi";
import { Badge } from "@/components/ui/badge";
import { BarList, Meter, StackedBar } from "@/components/ui/bars";
import { LinkButton } from "@/components/ui/button";
import { Empty } from "@/components/ui/empty";
import { DataTable, type Column } from "@/components/ui/data-table";

const VIEWS = [
  { key: "activities", label: "Activities" },
  { key: "classes", label: "By class" },
  { key: "students", label: "By student" },
] as const;

/** Student activities: what is running, how well each brings fees in, by class and by student. */
export function ActivitiesView({ sp }: { sp: SearchParams }) {
  const { writer } = useApp();
  const res = useApi<ActivitiesOverview>("/api/activities");
  const view = VIEWS.find((v) => v.key === param(sp.view))?.key ?? "activities";

  return (
    <div className="space-y-5">
      <PageHeader
        title="Student activities"
        description="What is running for students, how each activity is doing and the fees it brought in."
        info="An activity is something the school does for students that also helps recover fees: extra practice, a club, a trip open to students whose fees are paid. The accountant ticks at the fee counter which payments came in because of an activity; an activity is working well when half or more of its students who owe paid because of it."
        actions={
          writer && (
            <LinkButton href="/activities/new" variant="primary">
              <Plus className="size-4" /> New activity
            </LinkButton>
          )
        }
      />
      {res.data ? <Overview d={res.data} view={view} writer={writer} /> : <Pending queries={[res]} />}
    </div>
  );
}

function Overview({ d, view, writer }: { d: ActivitiesOverview; view: (typeof VIEWS)[number]["key"]; writer: boolean }) {
  const t = d.totals;
  const running = d.activities.filter((a) => a.status === "active");
  const closed = d.activities.filter((a) => a.status === "closed");
  const ranked = running.filter((a) => a.won_pct !== null && a.verdict !== "too_early" && a.verdict !== "no_students").sort((a, b) => (b.won_pct ?? 0) - (a.won_pct ?? 0));

  return (
    <>
      <div className="grid grid-cols-1 gap-4 min-[520px]:grid-cols-2 lg:grid-cols-4">
        <Kpi
          icon={Sparkles}
          color="indigo"
          label="Running"
          value={num(t.running)}
          sub={
            <>
              {t.good} working well · {t.poor} not working{t.closed > 0 ? ` · ${t.closed} closed` : ""}
            </>
          }
        />
        <Kpi icon={Users} color="blue" label="Students taking part" value={num(t.students_running)} sub={<>{t.positive} deposited fees · {t.negative} declined</>} />
        <Kpi
          icon={HandCoins}
          color="green"
          label="Brought in"
          value={rupeesShort(t.credited)}
          hint="Receipts the accountant counted for an activity at the fee counter."
          sub={<>{rupeesShort(t.credited_running)} from running ones</>}
        />
        <Kpi
          icon={Wallet}
          color="teal"
          label="Paid since they started"
          value={rupeesShort(t.paid_since)}
          hint="Everything the students taking part paid since their activity started, counted for it or not."
          sub={<>by students taking part</>}
        />
      </div>

      <Segmented options={VIEWS.map((v) => ({ label: v.label, href: withParams("/activities", { view: v.key === "activities" ? undefined : v.key }), active: v.key === view }))} />

      {view === "activities" &&
        (d.activities.length === 0 ? (
          <Card>
            <Empty title="No activities yet" icon={Sparkles}>
              {writer ? "Start one for a class, or for one student from the student's profile." : "Activities started by the admin or accountant show here."}
            </Empty>
          </Card>
        ) : (
          <>
            {ranked.length > 1 && (
              <Card title="Which activities work" description="Share of the students who owe that paid because of the activity (receipt counted for it).">
                <BarList
                  rows={ranked.map((a) => ({
                    label: a.name,
                    value: a.won_pct ?? 0,
                    display: pct(a.won_pct, 0),
                    sub: `${a.won} of ${a.owed} · ${rupeesShort(a.credited)}`,
                    href: `/activities/${a.id}`,
                  }))}
                  max={100}
                  color="bg-series-3"
                />
              </Card>
            )}
            {running.length > 0 && (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                {running.map((a) => (
                  <ActivityCard key={a.id} a={a} />
                ))}
              </div>
            )}
            {closed.length > 0 && (
              <>
                <h2 className="pt-2 text-headline font-semibold text-ink">Closed</h2>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {closed.map((a) => (
                    <ActivityCard key={a.id} a={a} />
                  ))}
                </div>
              </>
            )}
          </>
        ))}

      {view === "classes" && (
        <Card title="Running activities by class" description="Students of each class taking part in a running activity, their response and the money that came in.">
          <DataTable
            rows={d.by_class as unknown as Record<string, unknown>[]}
            columns={
              [
                { key: "class_name", label: "Class" },
                { key: "activities", label: "Activities", type: "number" },
                { key: "students", label: "Students", type: "number", total: true },
                { key: "positive", label: "Deposited", type: "number", total: true },
                { key: "negative", label: "Declined", type: "number", total: true, hideOnMobile: true },
                { key: "payers", label: "Paid something", type: "number", total: true, hideOnMobile: true },
                { key: "credited", label: "Because of it", type: "money", total: true },
                { key: "overdue_now", label: "Still overdue", type: "money", total: true, alertPositive: true },
              ] satisfies Column[]
            }
            exportName="activities-by-class"
            exportMeta={[`As of ${fmtDate(d.today)}`, "Running activities"]}
            empty="No class takes part in a running activity."
          />
        </Card>
      )}

      {view === "students" && (
        <Card title="Every student taking part">
          <DataTable
            rows={
              d.students.map((s) => ({
                ...s,
                class_label: s.class_name ? `${s.class_name}${s.section ? ` · ${s.section}` : ""}` : "Not enrolled",
                response_label: PARTICIPANT_LABELS[s.response].label,
                activity_label: s.activity_status === "closed" ? `${s.activity_name} (closed)` : s.activity_name,
              })) as unknown as Record<string, unknown>[]
            }
            columns={
              [
                { key: "full_name", label: "Student", type: "person", href: "/students/{student_id}", sub: "class_label" },
                { key: "activity_label", label: "Activity", href: "/activities/{activity_id}", sub: "note" },
                { key: "response_label", label: "Response" },
                { key: "paid_since", label: "Paid since start", type: "money", total: true, hideOnMobile: true },
                { key: "credited", label: "Because of it", type: "money", total: true },
                { key: "total_overdue", label: "Overdue now", type: "money", total: true, alertPositive: true },
              ] satisfies Column[]
            }
            searchKeys={["full_name", "admission_no", "activity_name", "class_label", "note"]}
            searchPlaceholder="Search student, activity, class…"
            filters={[
              { key: "activity_name", label: "Activity", options: d.activities.map((a) => ({ value: a.name, label: a.name })) },
              {
                key: "class_name",
                label: "Class",
                options: [...new Set(d.students.map((s) => s.class_name).filter((c): c is string => !!c))].map((c) => ({ value: c, label: c })),
              },
              { key: "response", label: "Response", options: PARTICIPANT_RESPONSES.map((r) => ({ value: r, label: PARTICIPANT_LABELS[r].label })) },
            ]}
            exportName="activity-students"
            exportMeta={[`As of ${fmtDate(d.today)}`]}
            empty="No students take part in an activity yet."
          />
        </Card>
      )}
    </>
  );
}

function ActivityCard({ a }: { a: ActivitySummary }) {
  const v = VERDICT_LABELS[a.verdict];
  return (
    <Link href={`/activities/${a.id}`} className="group block rounded-[var(--radius-card)] bg-surface p-5 shadow-card transition-transform duration-200 hover:-translate-y-0.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-headline font-semibold text-ink group-hover:text-accent">{a.name}</p>
          <p className="text-caption text-muted">
            {fmtDateShort(a.start_date)}
            {a.end_date ? ` – ${fmtDateShort(a.end_date)}` : ""} · {a.days_running} {a.days_running === 1 ? "day" : "days"}
            {a.classes.length > 0 ? ` · ${a.classes.join(", ")}` : ""}
          </p>
        </div>
        <Badge tone={v.tone} title={v.hint}>
          {v.label}
        </Badge>
      </div>

      <div className="mt-4 flex items-end justify-between gap-3">
        <div>
          <p className="figure text-title2 text-ink">{rupeesShort(a.credited)}</p>
          <p className="text-caption text-muted">
            because of it{a.target_amount ? ` · ${pct(ratioPct(a.credited, a.target_amount), 0)} of ${rupeesShort(a.target_amount)}` : ""}
          </p>
        </div>
        <div className="text-right">
          <p className="figure text-title3 text-ink">
            {a.won}/{a.owed}
          </p>
          <p className="text-caption text-muted">students who owe won</p>
        </div>
      </div>
      {a.target_amount ? <Meter value={ratioPct(a.credited, a.target_amount)} className="mt-3" color="bg-good" track="bg-good-soft" /> : null}

      <div className="mt-4">
        <StackedBar
          total={Math.max(1, a.participants)}
          segments={[
            { value: a.positive, className: "bg-good", label: "Deposited", display: String(a.positive) },
            { value: a.partial, className: "bg-warning", label: "Part", display: String(a.partial) },
            { value: a.negative, className: "bg-critical", label: "Declined", display: String(a.negative) },
          ]}
        />
        <p className="mt-2 text-caption text-muted">
          {a.participants} {a.participants === 1 ? "student" : "students"} · {a.positive} deposited · {a.partial} part · {a.negative} declined · {a.pending} waiting
        </p>
      </div>
    </Link>
  );
}
