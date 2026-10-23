"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { AlertTriangle, CalendarClock, History, Link2, UserPlus, UsersRound } from "lucide-react";
import { param, type SearchParams } from "@/lib/context";
import { apiUrl } from "@/lib/api/client";
import { useApi } from "@/lib/api/hooks";
import { fmtDate, fmtDateShort, num, pct, ratioPct, rupees, rupeesShort } from "@/lib/format";
import {
  BEHAVIOURS, BEHAVIOUR_LABELS, ECONOMIC, ECONOMIC_LABELS, OUTCOME_LABELS, PROMISE_LABELS, fmtPhone, type Behaviour, type Economic,
} from "@/lib/recovery";
import type { FeeStatus, ParentBalance } from "@/lib/types";
import { useApp } from "@/components/layout/app-shell";
import { NoSession } from "@/components/no-session";
import { Pending } from "@/components/ui/page-state";
import { PageHeader } from "@/components/ui/page-header";
import { Segmented, withParams } from "@/components/ui/segmented";
import { Kpi } from "@/components/ui/kpi";
import { Card } from "@/components/ui/card";
import { BarList } from "@/components/ui/bars";
import { Donut } from "@/components/ui/ring";
import { Button, LinkButton } from "@/components/ui/button";
import { DataTable, type Column } from "@/components/ui/data-table";
import { FormError, FormSuccess } from "@/components/ui/form";
import { Empty } from "@/components/ui/empty";
import { FEE_STATUS } from "@/components/ui/status";
import { linkByPhone } from "./actions";

const STATUS_ORDER: FeeStatus[] = ["paid_up", "partial", "arrears_only", "not_paying", "free"];
const STATUS_COLOR: Record<FeeStatus, string> = {
  paid_up: "var(--good)",
  partial: "var(--warning)",
  arrears_only: "var(--serious)",
  not_paying: "var(--critical)",
  free: "var(--tile-gray)",
  no_plan: "var(--surface-3)",
};

const SHOW = {
  all: { label: "All families", test: () => true },
  multi: { label: "2+ children", test: (p: ParentBalance) => p.children >= 2 },
  behind: { label: "Behind on fees", test: (p: ParentBalance) => p.total_overdue > 0 },
  old: { label: "Old dues", test: (p: ParentBalance) => p.prev_pending > 0 },
  empty: { label: "No children", test: (p: ParentBalance) => p.children === 0 },
} as const;
type Show = keyof typeof SHOW;

export function ParentsView({ sp }: { sp: SearchParams }) {
  const { session, writer } = useApp();
  const res = useApi<ParentBalance[]>(session ? apiUrl("/api/parents", { session: session.id }) : null);
  if (!session) return <NoSession />;
  if (!res.data) return <Pending queries={[res]} />;

  const families = res.data.filter((p) => p.children > 0);
  const empty = res.data.length - families.length;
  const showKey = (param(sp.show) ?? "all") as Show;
  const show = SHOW[showKey] ? showKey : "all";
  const rows = (show === "empty" ? res.data : families).filter(SHOW[show].test);

  const sum = (list: ParentBalance[], f: (p: ParentBalance) => number) => list.reduce((a, p) => a + f(p), 0);
  const multi = families.filter((p) => p.children >= 2);
  const behind = families.filter((p) => p.total_overdue > 0);
  const old = families.filter((p) => p.prev_pending > 0);
  const promised = families.filter((p) => p.promise_status === "pending");
  const statusCounts = STATUS_ORDER.map((s) => ({ s, n: families.filter((p) => p.family_status === s).length }));
  const statusTotal = statusCounts.reduce((a, x) => a + x.n, 0);

  // what families owe, grouped by what the staff know about them
  const group = <K extends string>(keys: readonly K[], of: (p: ParentBalance) => K | null, label: (k: K) => string, key: string) => {
    const out = keys.map((k) => ({ k: k as string, label: label(k), list: behind.filter((p) => of(p) === k) }));
    out.push({ k: "", label: "Not recorded yet", list: behind.filter((p) => of(p) === null) });
    return out
      .filter((g) => g.list.length > 0)
      .map((g) => ({
        label: g.label,
        value: sum(g.list, (p) => p.total_overdue),
        display: rupeesShort(sum(g.list, (p) => p.total_overdue)),
        sub: `${g.list.length} ${g.list.length === 1 ? "family" : "families"}`,
        href: g.k ? withParams("/parents", { show: "behind", [key]: g.k }) : undefined,
      }))
      .sort((a, b) => b.value - a.value);
  };
  const byHabit = group(BEHAVIOURS, (p) => p.payment_behaviour, (k: Behaviour) => BEHAVIOUR_LABELS[k].label, "habit");
  const byMeans = group(ECONOMIC, (p) => p.economic_status, (k: Economic) => ECONOMIC_LABELS[k], "means");

  const habit = param(sp.habit);
  const means = param(sp.means);
  const tableRows = rows
    .filter((p) => !habit || p.payment_behaviour === habit)
    .filter((p) => !means || p.economic_status === means)
    .map((p) => ({
      ...p,
      id: p.parent_id,
      kids: p.children_list.map((c) => `${c.full_name.split(" ")[0]}${c.class_name ? ` (${c.class_name})` : ""}`).join(", "),
      phone_display: fmtPhone(p.phone),
      kids_count: p.children >= 2 ? "2+" : "1",
      habit_label: p.payment_behaviour ? BEHAVIOUR_LABELS[p.payment_behaviour].label : null,
      means_label: p.economic_status ? ECONOMIC_LABELS[p.economic_status] : null,
      contact: p.last_call_on ? `${fmtDateShort(p.last_call_on)} · ${p.last_outcome ? OUTCOME_LABELS[p.last_outcome] : ""}` : null,
      promise:
        p.promise_status && p.promise_date
          ? `${PROMISE_LABELS[p.promise_status].label} · ${p.promise_amount ? rupees(p.promise_amount) + " by " : ""}${fmtDate(p.promise_date)}`
          : null,
    }));

  const columns: Column[] = [
    { key: "name", label: "Parent", type: "person", href: "/parents/{parent_id}", sub: "kids" },
    { key: "phone_display", label: "Phone", hideOnMobile: true, className: "whitespace-nowrap", sub: "habit_label" },
    { key: "total_pending", label: "Pending", type: "money", total: true },
    { key: "total_overdue", label: "Overdue", type: "money", total: true, alertPositive: true },
    { key: "prev_pending", label: "Old dues", type: "money", total: true, dimZero: true, hideOnMobile: true },
    { key: "days_since_payment", label: "Silent", type: "number", hideOnMobile: true },
    { key: "family_status", label: "Status", type: "status" },
    { key: "contact", label: "Last contact", hideOnMobile: true, className: "min-w-[180px]", sub: "promise" },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Parents"
        description={`${num(families.length)} families · ${num(multi.length)} with two or more children · ${session.name}`}
        info="Each family is one parent profile, found by phone number: brothers and sisters with the same number share it. Amounts are the children's fees added up, including old dues."
        actions={
          writer && (
            <LinkButton href="/parents/new" variant="primary">
              <UserPlus className="size-4" /> Add parent
            </LinkButton>
          )
        }
      >
        <Segmented
          options={(Object.keys(SHOW) as Show[])
            .filter((k) => k !== "empty" || empty > 0 || show === "empty")
            .map((k) => ({ label: SHOW[k].label, href: withParams("/parents", { show: k === "all" ? undefined : k }), active: k === show }))}
        />
      </PageHeader>

      <div className="grid grid-cols-1 gap-4 min-[520px]:grid-cols-2 lg:grid-cols-4">
        <Kpi icon={UsersRound} color="indigo" label="Families" value={num(families.length)} sub={<>{num(sum(families, (p) => p.children))} students · {num(multi.length)} with 2+ children</>} href={withParams("/parents", { show: "multi" })} />
        <Kpi
          icon={AlertTriangle}
          color="red"
          label="Behind on fees"
          value={rupeesShort(sum(behind, (p) => p.total_overdue))}
          tone="critical"
          sub={<>{num(behind.length)} families · {pct(ratioPct(behind.length, families.length), 0)} of all</>}
          href={withParams("/parents", { show: "behind" })}
        />
        <Kpi
          icon={History}
          color="orange"
          label="Old dues carried"
          value={rupeesShort(sum(old, (p) => p.prev_pending))}
          sub={<>{num(old.length)} families kept dues for this year</>}
          href={withParams("/parents", { show: "old" })}
        />
        <Kpi
          icon={CalendarClock}
          color="blue"
          label="Promises open"
          value={num(promised.length)}
          sub={promised.length > 0 ? <>{rupeesShort(sum(promised, (p) => p.promise_amount ?? 0))} promised</> : "No open promise"}
          href="/calls"
        />
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <Card title="Overdue by payment habit" description="Families behind on fees, grouped by how the staff say they pay. Click a row to list them.">
          {byHabit.length === 0 ? <Empty title="Nobody is behind" /> : <BarList rows={byHabit} color="bg-series-1" compact />}
        </Card>
        <Card title="Overdue by economic condition" description="Families behind on fees, grouped by the staff's view of their means.">
          {byMeans.length === 0 ? <Empty title="Nobody is behind" /> : <BarList rows={byMeans} color="bg-series-1" compact />}
        </Card>
        <Card title="Family fee status" description="All children of the family taken together, recalculated live.">
          <div className="flex flex-col items-center gap-5 sm:flex-row xl:flex-col">
            <Donut size={148} stroke={18} segments={statusCounts.map((x) => ({ value: x.n, color: STATUS_COLOR[x.s], label: FEE_STATUS[x.s].label }))}>
              <span className="figure text-title1 text-ink">{statusTotal}</span>
              <span className="text-caption text-ink-2">families</span>
            </Donut>
            <ul className="w-full space-y-1">
              {statusCounts
                .filter((x) => x.n > 0)
                .map((x) => (
                  <li key={x.s} className="flex items-center justify-between px-2 py-1 text-subhead">
                    <span className="flex items-center gap-2.5 text-ink">
                      <span className="size-2.5 rounded-full" style={{ background: STATUS_COLOR[x.s] }} aria-hidden />
                      {FEE_STATUS[x.s].label}
                    </span>
                    <span className="font-semibold tabular text-ink">{x.n}</span>
                  </li>
                ))}
            </ul>
          </div>
        </Card>
      </div>

      {(habit || means) && (
        <p className="text-footnote text-ink-2">
          Showing families who pay <b>{habit ? BEHAVIOUR_LABELS[habit as Behaviour]?.label : ECONOMIC_LABELS[means as Economic]}</b> ·{" "}
          <Link href={withParams("/parents", { show: show === "all" ? undefined : show })} className="font-medium text-accent hover:underline">
            Show all
          </Link>
        </p>
      )}

      <Card>
        <DataTable
          rows={tableRows as unknown as Record<string, unknown>[]}
          columns={columns}
          searchKeys={["name", "phone", "kids", "alt_phone"]}
          searchPlaceholder="Search parent, phone, child…"
          filters={[
            { key: "habit_label", label: "Pays", options: BEHAVIOURS.map((b) => ({ value: BEHAVIOUR_LABELS[b].label, label: BEHAVIOUR_LABELS[b].label })) },
            { key: "means_label", label: "Economic", options: ECONOMIC.map((e) => ({ value: ECONOMIC_LABELS[e], label: ECONOMIC_LABELS[e] })) },
            { key: "family_status", label: "Status", options: STATUS_ORDER.map((s) => ({ value: s, label: FEE_STATUS[s].label })) },
            { key: "kids_count", label: "Children", options: [{ value: "1", label: "One child" }, { value: "2+", label: "Two or more" }] },
          ]}
          defaultSort={{ key: "total_overdue", dir: "desc" }}
          pageSize={50}
          exportName={`parents-${session.name}`}
          exportMeta={[`Session ${session.name}`, `${SHOW[show].label}`, "Amounts include old dues"]}
          empty="No families match."
        />
      </Card>

      {writer && <LinkByPhone emptyProfiles={empty} />}
    </div>
  );
}

function LinkByPhone({ emptyProfiles }: { emptyProfiles: number }) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<{ message?: string; error?: string } | null>(null);
  return (
    <Card
      title="Families by phone number"
      description="Students are put into a family automatically when they are added or their phone number changes. Run this after changing data outside the app."
    >
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" disabled={pending} onClick={() => start(async () => setResult(await linkByPhone()))}>
          <Link2 className="size-4" /> {pending ? "Linking…" : "Link students by phone"}
        </Button>
        {emptyProfiles > 0 && (
          <span className="text-footnote text-ink-2">
            {emptyProfiles} {emptyProfiles === 1 ? "profile has" : "profiles have"} no children:{" "}
            <Link href="/parents?show=empty" className="font-medium text-accent hover:underline">
              merge or delete {emptyProfiles === 1 ? "it" : "them"}
            </Link>
            .
          </span>
        )}
      </div>
      <div className="mt-3">
        <FormError message={result?.error} />
        <FormSuccess message={result?.message} />
      </div>
    </Card>
  );
}
