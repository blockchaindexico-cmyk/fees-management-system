"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { CalendarRange, HandCoins, MessageSquareText, PhoneCall, Sparkles, TrendingDown, TrendingUp, Trophy, UsersRound } from "lucide-react";
import { useApi } from "@/lib/api/hooks";
import { cn } from "@/lib/cn";
import { fmtDateShort, monthLabel, num, pct, ratioPct, rupees, rupeesShort, todayIST } from "@/lib/format";
import { BEHAVIOUR_LABELS, PURPOSES, PURPOSE_LABELS } from "@/lib/recovery";
import type { RecoveryDashboard } from "@/lib/types";
import { type SearchParams, param } from "@/lib/context";
import { useApp } from "@/components/layout/app-shell";
import { Pending } from "@/components/ui/page-state";
import { PageHeader } from "@/components/ui/page-header";
import { Segmented, withParams } from "@/components/ui/segmented";
import { Card } from "@/components/ui/card";
import { IconTile, Kpi } from "@/components/ui/kpi";
import { BarList, Legend, Meter, StackedBar } from "@/components/ui/bars";
import { Button, LinkButton } from "@/components/ui/button";
import { Input } from "@/components/ui/form";
import { Empty } from "@/components/ui/empty";
import { CallsTrendChart, RecoverySourceChart } from "@/components/charts/charts";
import { PERIODS, resolvePeriod, type Period } from "./period";

/** Fee recovery dashboard: what came in over a period, what brought it in, and whether the calls and activities work. */
export function RecoveryView({ sp }: { sp: SearchParams }) {
  const { session, sessions } = useApp();
  const today = todayIST();
  const year = sessions.find((s) => s.start_date <= today && s.end_date >= today) ?? session;
  const period = resolvePeriod(param(sp.period), param(sp.from), param(sp.to), today, year?.start_date ?? null);
  const showCustom = param(sp.period) === "custom";
  const res = useApi<RecoveryDashboard>(withParams("/api/recovery", { from: period.from, to: period.to }));

  return (
    <div className="space-y-5">
      <PageHeader
        title="Fee recovery"
        description="How much came in, and what brought it in: calls, activities, or families paying on their own."
        info="The accountant ticks, at the fee counter, whether a payment came because of a call or an activity. Those ticks decide the split below; everything else counts as paid on their own."
        actions={
          <>
            <LinkButton href="/activities">
              <Sparkles className="size-4" /> Activities
            </LinkButton>
            <LinkButton href="/calls" variant="primary">
              <PhoneCall className="size-4" /> Today&rsquo;s calls
            </LinkButton>
          </>
        }
      >
        <div className="flex min-w-0 max-w-full flex-wrap items-center gap-3">
          <div className="-mx-1 max-w-full overflow-x-auto px-1">
            <Segmented
              options={PERIODS.map((p) => ({
                label: p.label,
                href: p.key === "custom" ? withParams("/recovery", { period: "custom", from: period.from, to: period.to }) : withParams("/recovery", { period: p.key }),
                active: showCustom ? p.key === "custom" : p.key === period.key,
              }))}
            />
          </div>
          {showCustom && <CustomRange period={period} today={today} />}
        </div>
      </PageHeader>

      {res.data ? <Dashboard d={res.data} period={period} /> : <Pending queries={[res]} />}
    </div>
  );
}

function CustomRange({ period, today }: { period: Period; today: string }) {
  const router = useRouter();
  const [from, setFrom] = useState(period.from);
  const [to, setTo] = useState(period.to);
  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (from && to && from <= to) router.push(withParams("/recovery", { period: "custom", from, to }), { scroll: false });
      }}
    >
      <Input type="date" aria-label="From" value={from} max={today} onChange={(e) => setFrom(e.target.value)} className="h-9 w-auto" />
      <span className="text-footnote text-muted">to</span>
      <Input type="date" aria-label="To" value={to} max={today} min={from} onChange={(e) => setTo(e.target.value)} className="h-9 w-auto" />
      <Button type="submit" size="sm" disabled={!from || !to || from > to}>
        Show
      </Button>
    </form>
  );
}

function bucketLabel(start: string, bucket: RecoveryDashboard["period"]["bucket"]) {
  if (bucket === "month") return monthLabel(start.slice(0, 7), false);
  return fmtDateShort(start);
}

function Dashboard({ d, period }: { d: RecoveryDashboard; period: Period }) {
  const m = d.money;
  const c = d.calls;
  const src = m.by_source;
  const change = m.prev_received > 0 ? ((m.received - m.prev_received) / m.prev_received) * 100 : null;
  const helped = src.calls.amount + src.activities.amount;
  const decided = c.kept + c.partial + c.broken;
  const multiDay = d.period.days > 1;
  const trend = m.trend.map((t) => ({
    ...t,
    label: bucketLabel(t.start, d.period.bucket),
    tooltipLabel: d.period.bucket === "week" ? `Week of ${fmtDateShort(t.start)}` : bucketLabel(t.start, d.period.bucket),
  }));
  const callTrend = c.trend.map((t) => ({
    label: bucketLabel(t.start, d.period.bucket),
    tooltipLabel: d.period.bucket === "week" ? `Week of ${fmtDateShort(t.start)}` : bucketLabel(t.start, d.period.bucket),
    connected: t.connected,
    not_reached: t.calls - t.connected,
  }));
  const topActivity = d.activities.find((a) => a.recovered > 0);
  const topCaller = c.by_caller[0];

  return (
    <>
      {/* hero: the money of the period and what brought it in */}
      <section className="rounded-[28px] bg-surface p-6 shadow-card sm:p-7">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] lg:items-center">
          <div>
            <p className="flex items-center gap-2 text-subhead font-medium text-ink-2">
              <CalendarRange className="size-4" /> Received · {period.label}
            </p>
            <p className="figure mt-2 text-[44px] leading-none text-ink">{rupees(m.received)}</p>
            <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-footnote text-ink-2">
              <span>
                {num(m.receipts)} {m.receipts === 1 ? "receipt" : "receipts"} from {num(m.families)} {m.families === 1 ? "family" : "families"}
              </span>
              {change !== null && (
                <span className={cn("inline-flex items-center gap-1 font-medium", change >= 0 ? "text-good-ink" : "text-critical-ink")}>
                  {change >= 0 ? <TrendingUp className="size-3.5" /> : <TrendingDown className="size-3.5" />}
                  {change >= 0 ? "+" : ""}
                  {pct(change, 0)} vs {period.before}
                </span>
              )}
            </p>
            {(m.by_kind.arrears ?? 0) > 0 && (
              <p className="mt-1.5 text-footnote text-ink-2">
                Includes <span className="font-medium text-serious-ink">{rupeesShort(m.by_kind.arrears ?? 0)}</span> of old dues.
              </p>
            )}
          </div>
          <div>
            <StackedBar
              height="h-3"
              total={m.received}
              segments={[
                { value: src.calls.amount, className: "bg-series-1", label: "After a call", display: rupeesShort(src.calls.amount) },
                { value: src.activities.amount, className: "bg-series-3", label: "From an activity", display: rupeesShort(src.activities.amount) },
                { value: src.direct.amount, className: "bg-series-track", label: "Paid on their own", display: rupeesShort(src.direct.amount) },
              ]}
            />
            <ul className="mt-4 grid gap-3 sm:grid-cols-3">
              <SourceTile color="bg-series-1" label="After a call" amount={src.calls.amount} total={m.received} families={src.calls.families} href="#calls" />
              <SourceTile color="bg-series-3" label="From an activity" amount={src.activities.amount} total={m.received} families={src.activities.families} href="#activities" />
              <SourceTile color="bg-series-track" label="Paid on their own" amount={src.direct.amount} total={m.received} families={src.direct.families} />
            </ul>
          </div>
        </div>
      </section>

      {/* the results in plain words */}
      <Card title="What the numbers say">
        <ul className="grid gap-3 md:grid-cols-2">
          <Insight icon={HandCoins} color="green">
            {m.received === 0 ? (
              <>No money came in {period.key === "today" ? "yet today" : "in this period"}.</>
            ) : helped > 0 ? (
              <>
                <b>{pct(ratioPct(helped, m.received), 0)}</b> of the money ({rupeesShort(helped)}) came after a call or an activity.
              </>
            ) : (
              <>None of the receipts were marked as coming from a call or an activity.</>
            )}
          </Insight>
          <Insight icon={PhoneCall} color="blue">
            {d.impact.spoke === 0 ? (
              <>No fee call got through in this period, so the effect of calling cannot be measured yet.</>
            ) : d.impact.lift !== null && d.impact.lift >= 1.1 ? (
              <>
                Calling works: families we spoke to paid <b>{d.impact.lift}×</b> as often ({pct(d.impact.spoke_pct, 0)} against {pct(d.impact.others_pct, 0)} of
                other families with dues).
              </>
            ) : d.impact.lift !== null && d.impact.lift < 0.9 ? (
              <>
                Families we spoke to paid <b>less often</b> than others ({pct(d.impact.spoke_pct, 0)} against {pct(d.impact.others_pct, 0)}). Look at what parents
                said and the promises.
              </>
            ) : (
              <>
                Families we spoke to paid about as often as others ({pct(d.impact.spoke_pct, 0)} against {pct(d.impact.others_pct, 0)}).
              </>
            )}
          </Insight>
          <Insight icon={Sparkles} color="teal">
            {topActivity ? (
              <>
                <b>{topActivity.name}</b> brought in the most: {rupeesShort(topActivity.recovered)} from {topActivity.students_paid}{" "}
                {topActivity.students_paid === 1 ? "student" : "students"}.
              </>
            ) : d.activities.length > 0 ? (
              <>No receipt was counted for an activity in this period.</>
            ) : (
              <>No student activity ran in this period.</>
            )}
          </Insight>
          <Insight icon={MessageSquareText} color="indigo">
            {c.promises === 0 ? (
              <>No promises to pay were made in this period.</>
            ) : decided > 0 ? (
              <>
                <b>
                  {c.kept} of {decided}
                </b>{" "}
                promises that fell due were kept ({pct(ratioPct(c.kept, decided), 0)}){c.pending > 0 ? <>; {c.pending} still waiting for their date</> : null}.
              </>
            ) : (
              <>
                {c.promises} {c.promises === 1 ? "promise" : "promises"} made ({rupeesShort(c.promised_amount)}); none has fallen due yet.
              </>
            )}
          </Insight>
          {topCaller && topCaller.calls > 0 && (
            <Insight icon={Trophy} color="orange">
              <b>{topCaller.name}</b> made the most calls: {topCaller.calls}, {pct(ratioPct(topCaller.connected, topCaller.calls), 0)} picked up
              {topCaller.recovered > 0 ? <>, {rupeesShort(topCaller.recovered)} came in after them</> : null}.
            </Insight>
          )}
        </ul>
      </Card>

      {multiDay && (
        <Card title="How the money came in" description="Each bar is a day (a week or a month for long periods), split by what brought the money in.">
          <RecoverySourceChart data={trend} />
        </Card>
      )}

      <div className="grid grid-cols-1 gap-4 min-[520px]:grid-cols-2 lg:grid-cols-4" id="calls">
        <Kpi icon={PhoneCall} color="blue" label="Calls made" value={num(c.calls)} sub={<>{c.per_day} a day · {c.callers} {c.callers === 1 ? "caller" : "callers"}</>} href="/calls" />
        <Kpi
          icon={UsersRound}
          color="indigo"
          label="Picked up"
          value={pct(ratioPct(c.connected, c.calls), 0)}
          meter={ratioPct(c.connected, c.calls)}
          sub={<>{num(c.connected)} picked up · {num(c.not_reached)} not reached</>}
        />
        <Kpi
          icon={MessageSquareText}
          color="teal"
          label="Promised to pay"
          value={num(c.promises)}
          sub={<>{rupeesShort(c.promised_amount)} promised · {rupeesShort(c.promise_paid)} paid against it</>}
        />
        <Kpi icon={HandCoins} color="green" label="Came in after calls" value={rupeesShort(c.recovered)} sub={<>Receipts ticked to a call at the counter</>} />
      </div>

      <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-3">
        <div className="space-y-5 xl:col-span-2">
          {multiDay && c.calls > 0 && (
            <Card title="Calls per day" description="Every call, about fees or anything else.">
              <CallsTrendChart data={callTrend} />
            </Card>
          )}

          <Card
            title="Who called the most"
            description="Calls made in the period, how many got through, the promises they got (kept so far) and the money ticked to their calls."
          >
            {c.by_caller.length === 0 ? (
              <Empty title="No calls in this period" icon={PhoneCall} />
            ) : (
              <div className="-mx-2 overflow-x-auto">
                <table className="w-full min-w-[520px] text-subhead">
                  <thead>
                    <tr className="text-left text-caption font-medium text-muted">
                      <th className="px-2 pb-2 font-medium">Caller</th>
                      <th className="px-2 pb-2 text-right font-medium">Calls</th>
                      <th className="px-2 pb-2 font-medium">Picked up</th>
                      <th className="px-2 pb-2 text-right font-medium">Promises</th>
                      <th className="px-2 pb-2 text-right font-medium">Came in</th>
                    </tr>
                  </thead>
                  <tbody>
                    {c.by_caller.map((x, i) => (
                      <tr key={x.user_id} className="border-t border-line">
                        <td className="px-2 py-2.5">
                          <span className="font-medium text-ink">{x.name}</span>
                          {i === 0 && x.calls > 0 && <Trophy className="ml-1.5 inline size-3.5 text-warning" aria-label="Most calls" />}
                          <span className="block text-caption text-muted">
                            {x.families} {x.families === 1 ? "family" : "families"}
                          </span>
                        </td>
                        <td className="px-2 py-2.5 text-right tabular font-semibold text-ink">{x.calls}</td>
                        <td className="min-w-[120px] px-2 py-2.5">
                          <span className="tabular text-footnote text-ink-2">{pct(ratioPct(x.connected, x.calls), 0)}</span>
                          <Meter value={ratioPct(x.connected, x.calls)} className="mt-1" />
                        </td>
                        <td className="px-2 py-2.5 text-right tabular">
                          {x.promises}
                          {x.promises > 0 && <span className="block text-caption text-muted">{x.kept} kept · {x.broken} broken</span>}
                        </td>
                        <td className="px-2 py-2.5 text-right tabular font-semibold text-good-ink">{rupeesShort(x.recovered)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>

        <div className="space-y-5">
          <Card
            title="Does calling make a difference?"
            description="Families we spoke to about fees in the period (paid on or after the call) against the other families with dues (owing now, or who paid overdue fees in the period)."
          >
            {d.impact.spoke === 0 && d.impact.others === 0 ? (
              <p className="text-footnote text-muted">No families with dues in this period.</p>
            ) : (
              <div className="space-y-4">
                <Compare
                  label="We spoke to them"
                  pctValue={d.impact.spoke_pct}
                  paid={d.impact.spoke_paid}
                  of={d.impact.spoke}
                  amount={d.impact.spoke_amount}
                  color="bg-series-1"
                />
                <Compare
                  label="Not spoken to"
                  pctValue={d.impact.others_pct}
                  paid={d.impact.others_paid}
                  of={d.impact.others}
                  amount={d.impact.others_amount}
                  color="bg-tile-gray"
                />
                {d.impact.lift !== null && (
                  <p className="rounded-xl bg-fill-2 px-3 py-2 text-footnote text-ink">
                    {d.impact.lift >= 1.1
                      ? `Talking to a family makes it ${d.impact.lift}× as likely to pay.`
                      : d.impact.lift < 0.9
                        ? "Families we spoke to paid less often than the others."
                        : "No clear difference yet."}
                  </p>
                )}
              </div>
            )}
          </Card>

          <Card title="Promises made in the period" description="Kept = paid by the promised date, or within the grace days after it.">
            {c.promises === 0 ? (
              <p className="text-footnote text-muted">No promises yet.</p>
            ) : (
              <>
                <StackedBar
                  total={c.promises}
                  segments={[
                    { value: c.kept_on_time, className: "bg-good", label: "By the date", display: String(c.kept_on_time) },
                    { value: c.kept - c.kept_on_time, className: "bg-series-3", label: "Within grace", display: String(c.kept - c.kept_on_time) },
                    { value: c.partial, className: "bg-warning", label: "In part", display: String(c.partial) },
                    { value: c.broken, className: "bg-critical", label: "Broken", display: String(c.broken) },
                  ]}
                />
                <Legend
                  className="mt-3"
                  items={[
                    { label: "By the date", className: "bg-good", value: String(c.kept_on_time) },
                    { label: "Within grace", className: "bg-series-3", value: String(c.kept - c.kept_on_time) },
                    { label: "In part", className: "bg-warning", value: String(c.partial) },
                    { label: "Broken", className: "bg-critical", value: String(c.broken) },
                    { label: "Waiting", className: "bg-fill", value: String(c.pending) },
                  ]}
                />
              </>
            )}
          </Card>

          <Card title="What the calls were about">
            {c.calls === 0 ? (
              <p className="text-footnote text-muted">No calls yet.</p>
            ) : (
              <BarList
                compact
                rows={PURPOSES.filter((p) => (c.by_purpose[p] ?? 0) > 0).map((p) => ({
                  label: PURPOSE_LABELS[p].label,
                  value: c.by_purpose[p] ?? 0,
                  display: String(c.by_purpose[p]),
                  sub: pct(ratioPct(c.by_purpose[p] ?? 0, c.calls), 0),
                }))}
              />
            )}
          </Card>
        </div>
      </div>

      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-2">
        <Card
          id="activities"
          title="Which activity brought the most"
          description="Receipts of the period counted for each activity at the fee counter."
          actions={
            <Link href="/activities" className="text-footnote font-medium text-accent">
              All activities
            </Link>
          }
        >
          {d.activities.length === 0 ? (
            <Empty title="No activities in this period" icon={Sparkles} />
          ) : (
            <BarList
              color="bg-series-3"
              rows={d.activities.map((a) => ({
                label: a.name,
                value: a.recovered,
                display: rupeesShort(a.recovered),
                sub: `${a.students_paid} of ${a.participants} paid`,
                href: `/activities/${a.id}`,
              }))}
            />
          )}
        </Card>

        <Card title="Who paid, by payment habit" description="The money of the period by the payment habit recorded on each family's profile.">
          {m.by_behaviour.length === 0 ? (
            <p className="text-footnote text-muted">No money in this period.</p>
          ) : (
            <BarList
              rows={m.by_behaviour.map((b) => ({
                label: b.behaviour ? BEHAVIOUR_LABELS[b.behaviour].label : "Habit not recorded",
                value: b.amount,
                display: rupeesShort(b.amount),
                sub: `${b.families} ${b.families === 1 ? "family" : "families"}`,
              }))}
            />
          )}
        </Card>
      </div>
    </>
  );
}

function SourceTile({ color, label, amount, total, families, href }: { color: string; label: string; amount: number; total: number; families: number; href?: string }) {
  const body = (
    <>
      <span className="flex items-center gap-1.5 text-footnote text-ink-2">
        <span className={cn("size-2 rounded-full", color)} aria-hidden /> {label}
      </span>
      <span className="figure mt-1 block text-title3 text-ink">{rupeesShort(amount)}</span>
      <span className="text-caption text-muted">
        {pct(ratioPct(amount, total), 0)} · {families} {families === 1 ? "family" : "families"}
      </span>
    </>
  );
  return <li className="rounded-2xl bg-fill-2 px-3.5 py-3">{href ? <a href={href}>{body}</a> : body}</li>;
}

function Insight({ icon, color, children }: { icon: React.ElementType; color: "green" | "blue" | "teal" | "indigo" | "orange"; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-3 rounded-2xl bg-fill-2 p-3.5 text-subhead text-ink">
      <IconTile icon={icon} color={color} size="sm" />
      <span className="min-w-0 [&_b]:font-semibold">{children}</span>
    </li>
  );
}

function Compare({ label, pctValue, paid, of, amount, color }: { label: string; pctValue: number | null; paid: number; of: number; amount: number; color: string }) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-subhead text-ink">{label}</span>
        <span className="figure text-title3 text-ink">{pct(pctValue, 0)}</span>
      </div>
      <div className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-fill-2" aria-hidden>
        <div className={cn("h-full rounded-full", color)} style={{ width: `${Math.max(0, Math.min(100, pctValue ?? 0))}%` }} />
      </div>
      <p className="mt-1 text-caption text-muted">
        {paid} of {of} {of === 1 ? "family" : "families"} paid · {rupeesShort(amount)}
      </p>
    </div>
  );
}
