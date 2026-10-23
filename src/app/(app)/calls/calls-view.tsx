"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  CalendarClock, CheckCircle2, ChevronRight, Hand, HandCoins, Info, MessageSquareText, Phone, PhoneCall, PhoneMissed, Search, Undo2, UsersRound,
} from "lucide-react";
import { useApi } from "@/lib/api/hooks";
import { apiFetch } from "@/lib/api/client";
import { cn } from "@/lib/cn";
import { type SearchParams, param } from "@/lib/context";
import { fmtDate, fmtDateShort, fmtTime, num, pct, ratioPct, rupees, rupeesShort } from "@/lib/format";
import { OUTCOME_LABELS, PURPOSE_LABELS, REASON_LABELS, RESPONSE_LABELS, fmtPhone } from "@/lib/recovery";
import type { ActionState } from "@/lib/action-state";
import type { CallBoard, CallListRow, CallerWindow, StudentRecovery } from "@/lib/types";
import { useApp } from "@/components/layout/app-shell";
import { StudentSearch } from "@/components/layout/student-search";
import { Pending } from "@/components/ui/page-state";
import { PageHeader } from "@/components/ui/page-header";
import { Segmented, withParams } from "@/components/ui/segmented";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Ring } from "@/components/ui/ring";
import { Empty } from "@/components/ui/empty";
import { FormError, FormSuccess, Input } from "@/components/ui/form";
import { PromiseLine } from "@/components/recovery";
import { releaseCalls, takeCalls, takeFamily } from "./actions";

const TABS = [
  { key: "mine", label: "My list" },
  { key: "all", label: "Everyone to call" },
  { key: "done", label: "Called today" },
] as const;

const WINDOWS = [
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "week", label: "7 days" },
  { key: "month", label: "30 days" },
] as const;

/**
 * The calling page. Every day the system lists the families to call, best first, each with its main reason.
 * A caller takes a batch ("my list"), calls, and logs what was said; called families move to "Called today".
 */
export function CallsView({ sp }: { sp: SearchParams }) {
  const res = useApi<CallBoard>("/api/calls");
  if (!res.data) return <Pending queries={[res]} />;
  return <Board d={res.data} tab={param(sp.tab)} />;
}

function useAction() {
  const [pending, start] = useTransition();
  const [state, setState] = useState<ActionState>({});
  const run = (fn: () => Promise<ActionState>) => start(async () => setState(await fn()));
  return { pending, state, run };
}

function Board({ d, tab: tabParam }: { d: CallBoard; tab?: string }) {
  const { admin } = useApp();
  const me = d.me;
  const tab = TABS.find((t) => t.key === tabParam)?.key ?? (me.taken === 0 && d.counts.due_open > 0 ? "all" : "mine");
  const mine = d.rows.filter((r) => r.assigned_to === me.id);
  const due = d.rows.filter((r) => r.state === "due");
  const action = useAction();
  const firstToCall = mine.find((r) => r.state === "due");

  return (
    <div className="space-y-5">
      <PageHeader
        title="Calls"
        description={`${fmtDate(d.today)} · ${num(d.counts.due)} ${d.counts.due === 1 ? "family" : "families"} to call today, best first.`}
        info={<Rules d={d} />}
        actions={
          <>
            <CallAnyFamily />
            {admin && (
              <Link href="/settings#call-rules" className="text-footnote font-medium text-accent">
                List rules
              </Link>
            )}
          </>
        }
      />

      {/* my day: my list and my figures */}
      <section className="grid gap-5 rounded-[28px] bg-surface p-6 shadow-card lg:grid-cols-[auto_minmax(0,1fr)]">
        <div className="flex items-center gap-5">
          <Ring value={me.taken > 0 ? ratioPct(me.taken - me.left, me.taken) : 0} size={112} stroke={11} label="My list done">
            <span className="figure text-title2 text-ink">{me.taken - me.left}</span>
            <span className="text-caption text-muted">of {me.taken}</span>
          </Ring>
          <div className="space-y-2">
            <p className="text-headline font-semibold text-ink">
              {me.taken === 0 ? "Your list is empty" : me.left === 0 ? "Your list is done" : `${me.left} left to call`}
            </p>
            <p className="max-w-[260px] text-footnote text-ink-2">
              {d.counts.due_open > 0
                ? `${num(d.counts.due_open)} ${d.counts.due_open === 1 ? "family is" : "families are"} not with any caller yet.`
                : "Every family on today's list is with a caller."}
            </p>
            <div className="flex flex-wrap gap-2">
              {firstToCall ? (
                <Link href={`/calls/${firstToCall.parent_id}`} className="inline-flex h-9 items-center gap-1.5 rounded-full bg-accent px-4 text-subhead font-medium text-accent-ink">
                  <PhoneCall className="size-4" /> Start calling
                </Link>
              ) : null}
              {d.counts.due_open > 0 && (
                <Button variant={firstToCall ? "secondary" : "primary"} disabled={action.pending} onClick={() => action.run(() => takeCalls())}>
                  <Hand className="size-4" /> Give me {Math.min(d.rules.batch, d.counts.due_open)} {firstToCall ? "more" : "families"}
                </Button>
              )}
            </div>
            <FormError message={action.state.error} />
            <FormSuccess message={action.state.message} />
          </div>
        </div>
        <MyFigures stats={me.stats} />
      </section>

      <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-3">
        <div className="space-y-3 xl:col-span-2">
          <Segmented
            options={TABS.map((t) => ({
              label: `${t.label} ${t.key === "mine" ? mine.length : t.key === "all" ? due.length : d.calls_today.length}`,
              href: withParams("/calls", { tab: t.key }),
              active: t.key === tab,
            }))}
          />
          {tab === "mine" && <MyList rows={mine} canTake={d.counts.due_open > 0} batch={d.rules.batch} />}
          {tab === "all" && <EveryoneList rows={due} meId={me.id} />}
          {tab === "done" && <CalledToday d={d} />}
        </div>

        <div className="space-y-5">
          <Card title="Not on today's list" description="Families with dues the rules keep off today's list. They come back on their own.">
            <ul className="space-y-2.5 text-subhead">
              <Off icon={MessageSquareText} label="Promised to pay, waiting for the date" n={d.counts.promised} extra={d.counts.promised_amount > 0 ? rupeesShort(d.counts.promised_amount) : null} />
              <Off icon={HandCoins} label={`Paid in the last ${d.rules.skip_paid_days} days`} n={d.counts.paid_recently} />
              <Off icon={CalendarClock} label="Called recently" n={d.counts.waiting} />
            </ul>
          </Card>

          {d.promises_due.length > 0 && (
            <Card title="Promises falling due" description="If unpaid by the date and the grace days, the family is back on the list.">
              <ul className="space-y-3">
                {d.promises_due.map((p) => (
                  <li key={p.parent_id} className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <Link href={`/parents/${p.parent_id}`} className="block truncate text-subhead font-medium text-ink hover:text-accent">
                        {p.name}
                      </Link>
                      <span className="text-caption text-muted">{fmtPhone(p.phone)}</span>
                    </div>
                    <span className="shrink-0 text-right text-footnote">
                      <span className="font-semibold text-ink">{p.promise_amount ? rupees(p.promise_amount) : "Payment"}</span>
                      <span className="block text-caption text-muted">by {fmtDateShort(p.promise_date)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <Card title="Callers today">
            {d.team.length === 0 ? (
              <p className="text-footnote text-muted">Nobody has called or taken families yet today.</p>
            ) : (
              <ul className="space-y-3">
                {d.team.map((t) => (
                  <li key={t.user_id}>
                    <div className="flex items-baseline justify-between gap-2 text-subhead">
                      <span className="text-ink">
                        {t.name}
                        {t.is_me && <span className="text-muted"> (you)</span>}
                      </span>
                      <span className="tabular">
                        <span className="font-semibold text-ink">{t.calls}</span>
                        <span className="ml-1 text-footnote text-muted">{t.calls === 1 ? "call" : "calls"}</span>
                      </span>
                    </div>
                    <p className="text-caption text-muted">
                      {t.connected} picked up · {t.promises} {t.promises === 1 ? "promise" : "promises"}
                      {t.taken > 0 && <> · {t.left} of {t.taken} left</>}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

function Rules({ d }: { d: CallBoard }) {
  const r = d.rules;
  return (
    <>
      The list is made fresh every day: families owing {rupees(r.min_overdue)} or more in overdue fees, except those who paid in the last {r.skip_paid_days} days,
      those waiting for a promised date (plus {r.grace_days} grace {r.grace_days === 1 ? "day" : "days"}) and those called recently ({r.gap_days} days after a
      call that got through, the next day if nobody picked up). Broken promises and call-backs come first, then the biggest and oldest dues.
    </>
  );
}

function MyFigures({ stats }: { stats: CallBoard["me"]["stats"] }) {
  const [key, setKey] = useState<(typeof WINDOWS)[number]["key"]>("today");
  const s: CallerWindow = stats[key];
  return (
    <div className="min-w-0">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-subhead font-semibold text-ink">My calls</p>
        <div className="inline-flex rounded-[10px] bg-fill p-[2px] text-caption" role="group" aria-label="Period">
          {WINDOWS.map((w) => (
            <button
              key={w.key}
              type="button"
              aria-pressed={key === w.key}
              onClick={() => setKey(w.key)}
              className={
                key === w.key
                  ? "rounded-[8px] bg-surface px-2.5 py-[3px] font-medium text-ink shadow-[0_1px_3px_rgba(0,0,0,0.12)] dark:bg-surface-3"
                  : "rounded-[8px] px-2.5 py-[3px] font-medium text-ink-2 hover:text-ink"
              }
            >
              {w.label}
            </button>
          ))}
        </div>
      </div>
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        <Fig label="Calls" value={num(s.calls)} sub={`${s.families} ${s.families === 1 ? "family" : "families"}`} />
        <Fig label="Picked up" value={pct(ratioPct(s.connected, s.calls), 0)} sub={`${s.connected} of ${s.calls}`} />
        <Fig label="Not reached" value={num(s.not_reached)} sub="didn't pick up" />
        <Fig label="Promised to pay" value={num(s.promises)} sub={s.promised_amount > 0 ? rupeesShort(s.promised_amount) : s.kept > 0 ? `${s.kept} kept` : "—"} />
        <Fig label="Came in" value={rupeesShort(s.recovered)} sub="from my calls" good />
      </dl>
      {s.calls > 0 && (
        <p className="mt-2.5 flex flex-wrap gap-1.5">
          {Object.entries(s.by_purpose).map(([p, n]) => (
            <Badge key={p}>
              {PURPOSE_LABELS[p as keyof typeof PURPOSE_LABELS].short} {n}
            </Badge>
          ))}
          {s.kept + s.broken > 0 && (
            <Badge tone={s.kept >= s.broken ? "good" : "serious"}>
              Promises: {s.kept} kept · {s.broken} not
            </Badge>
          )}
        </p>
      )}
    </div>
  );
}

function Fig({ label, value, sub, good }: { label: string; value: string; sub: string; good?: boolean }) {
  return (
    <div className="rounded-2xl bg-fill-2 px-3 py-2.5">
      <dt className="text-caption text-muted">{label}</dt>
      <dd className={cn("figure mt-0.5 text-title3", good ? "text-good-ink" : "text-ink")}>{value}</dd>
      <dd className="truncate text-caption text-muted">{sub}</dd>
    </div>
  );
}

function Off({ icon: Icon, label, n, extra }: { icon: React.ElementType; label: string; n: number; extra?: string | null }) {
  return (
    <li className="flex items-center justify-between gap-3">
      <span className="flex items-center gap-2 text-ink-2">
        <Icon className="size-4 text-muted" aria-hidden /> {label}
      </span>
      <span className="shrink-0 tabular">
        <span className="font-semibold text-ink">{num(n)}</span>
        {extra && <span className="ml-1 text-footnote text-muted">{extra}</span>}
      </span>
    </li>
  );
}

function MyList({ rows, canTake, batch }: { rows: CallListRow[]; canTake: boolean; batch: number }) {
  const action = useAction();
  const toCall = rows.filter((r) => r.state === "due");
  const done = rows.filter((r) => r.state !== "due");
  if (rows.length === 0) {
    return (
      <Card>
        <Empty title="Nobody on your list yet" icon={UsersRound}>
          {canTake ? (
            <>
              Take the next {batch} families from today&rsquo;s list, or pick families yourself in &ldquo;Everyone to call&rdquo;.
              <div className="mt-4">
                <Button variant="primary" disabled={action.pending} onClick={() => action.run(() => takeCalls())}>
                  <Hand className="size-4" /> Give me {batch} families
                </Button>
              </div>
              <FormError message={action.state.error} />
            </>
          ) : (
            "Every family on today's list is with a caller."
          )}
        </Empty>
      </Card>
    );
  }
  return (
    <Card bodyClassName="p-2 sm:p-3">
      {toCall.length > 0 && (
        <div className="flex items-center justify-between px-3 pb-1 pt-2">
          <p className="text-footnote font-medium text-ink-2">To call · {toCall.length}</p>
          <button
            type="button"
            disabled={action.pending}
            onClick={() => {
              if (confirm("Give the families you have not called back to today's list?")) action.run(() => releaseCalls());
            }}
            className="inline-flex items-center gap-1 text-footnote font-medium text-muted hover:text-ink"
          >
            <Undo2 className="size-3.5" /> Give back
          </button>
        </div>
      )}
      <ul className="divide-y divide-line">
        {toCall.map((r) => (
          <FamilyRow key={r.parent_id} r={r} />
        ))}
      </ul>
      {done.length > 0 && (
        <>
          <p className="px-3 pb-1 pt-4 text-footnote font-medium text-ink-2">Done · {done.length}</p>
          <ul className="divide-y divide-line">
            {done.map((r) => (
              <FamilyRow key={r.parent_id} r={r} />
            ))}
          </ul>
        </>
      )}
      <div className="px-3">
        <FormError message={action.state.error} />
      </div>
    </Card>
  );
}

function EveryoneList({ rows, meId }: { rows: CallListRow[]; meId: string }) {
  const [q, setQ] = useState("");
  const [shown, setShown] = useState(40);
  const needle = q.trim().toLowerCase();
  const filtered = needle
    ? rows.filter((r) =>
        [r.name, r.phone, ...r.children.map((k) => k.full_name), ...r.reasons.map((x) => REASON_LABELS[x].label)].some((v) => v.toLowerCase().includes(needle)),
      )
    : rows;
  if (rows.length === 0) {
    return (
      <Card>
        <Empty title="Nobody to call right now" icon={CheckCircle2}>
          Every family with dues has paid recently, promised a date, or was called recently.
        </Empty>
      </Card>
    );
  }
  return (
    <Card bodyClassName="p-2 sm:p-3">
      <div className="relative px-1 pb-2 pt-1">
        <Search className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search family, child, phone, reason…" className="pl-9" aria-label="Search the list" />
      </div>
      <ul className="divide-y divide-line">
        {filtered.slice(0, shown).map((r) => (
          <FamilyRow key={r.parent_id} r={r} take={r.assigned_to === null} takenBy={r.assigned_to && r.assigned_to !== meId ? r.assigned_name : null} />
        ))}
      </ul>
      {filtered.length > shown && (
        <div className="p-3 text-center">
          <Button size="sm" onClick={() => setShown((n) => n + 40)}>
            Show more ({filtered.length - shown})
          </Button>
        </div>
      )}
      {filtered.length === 0 && <p className="p-4 text-center text-footnote text-muted">No family matches.</p>}
    </Card>
  );
}

/** One family on the list: why they are on it, what they owe, the last contact, and the way to call. */
function FamilyRow({ r, take, takenBy }: { r: CallListRow; take?: boolean; takenBy?: string | null }) {
  const action = useAction();
  const main = r.reasons[0];
  const kids = r.children.map((k) => `${k.full_name.split(" ")[0]}${k.class_name ? ` (${k.class_name})` : ""}`).join(", ");
  const tc = r.today_call;
  return (
    <li className="flex flex-wrap items-start gap-x-3 gap-y-2 px-3 py-3">
      <span
        className={cn(
          "mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-full text-footnote font-semibold tabular",
          r.state === "due" ? "bg-accent-soft text-accent" : "bg-good-soft text-good-ink",
        )}
        aria-label={r.state === "due" ? `Number ${r.rank} on today's list` : "Done"}
      >
        {r.state === "due" ? r.rank : <CheckCircle2 className="size-4" />}
      </span>
      <div className="min-w-0 flex-1 basis-[220px]">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <Link href={`/calls/${r.parent_id}`} className="text-subhead font-semibold text-ink hover:text-accent">
            {r.name}
          </Link>
          {main && r.state === "due" && (
            <Badge tone={REASON_LABELS[main].tone} title={REASON_LABELS[main].hint}>
              {REASON_LABELS[main].label}
            </Badge>
          )}
          {r.reasons.slice(1).map((x) => (
            <span key={x} className="text-caption text-muted" title={REASON_LABELS[x].hint}>
              · {REASON_LABELS[x].label}
            </span>
          ))}
        </div>
        {kids && <p className="truncate text-footnote text-ink-2">{kids}</p>}
        {tc ? (
          <p className="mt-1 text-footnote text-good-ink">
            Called {fmtTime(tc.called_at)}
            {tc.caller_name ? ` by ${tc.caller_name}` : ""} · {OUTCOME_LABELS[tc.outcome]}
            {tc.response ? ` · ${RESPONSE_LABELS[tc.response]}` : ""}
            {tc.promised_date ? ` · promised ${tc.promised_amount ? rupees(tc.promised_amount) : ""} by ${fmtDateShort(tc.promised_date)}` : ""}
          </p>
        ) : r.state === "paid_recently" ? (
          <p className="mt-1 text-footnote text-good-ink">Paid {r.last_paid_amount ? rupees(r.last_paid_amount) : ""} on {fmtDateShort(r.last_paid_on)}: no need to call.</p>
        ) : r.state === "promised" && r.promise_date ? (
          <p className="mt-1 text-footnote">
            <PromiseLine date={r.promise_date} amount={r.promise_amount} status={r.promise_status} />
          </p>
        ) : r.state === "cleared" ? (
          <p className="mt-1 text-footnote text-good-ink">No dues to call about now.</p>
        ) : (
          <p className="mt-1 text-footnote text-muted">
            {r.last_paid_on
              ? `Last paid ${r.last_paid_amount ? rupees(r.last_paid_amount) : ""} ${r.days_since_payment} ${r.days_since_payment === 1 ? "day" : "days"} ago`
              : "Never paid"}
            {r.last_call_on && (
              <>
                {" · "}last call {fmtDateShort(r.last_call_on)}: {r.last_response ? RESPONSE_LABELS[r.last_response] : r.last_outcome ? OUTCOME_LABELS[r.last_outcome] : ""}
              </>
            )}
            {r.promise_date && (r.promise_status === "broken" || r.promise_status === "partial") && (
              <> · promised {r.promise_amount ? rupees(r.promise_amount) : ""} by {fmtDateShort(r.promise_date)}</>
            )}
          </p>
        )}
        {takenBy && <p className="mt-0.5 text-caption text-muted">With {takenBy} today</p>}
      </div>
      <div className="flex shrink-0 items-center gap-2 max-sm:w-full max-sm:justify-between max-sm:pl-11">
        <span className="text-right">
          <span className="block text-subhead font-semibold tabular text-critical-ink">{rupeesShort(r.total_overdue)}</span>
          <span className="block text-caption text-muted">overdue</span>
        </span>
        {take ? (
          <Button size="sm" disabled={action.pending} onClick={() => action.run(() => takeFamily(r.parent_id))} title="Add to my list">
            <Hand className="size-3.5" /> Take
          </Button>
        ) : null}
        <a
          href={`tel:${r.phone}`}
          className="inline-flex size-9 items-center justify-center rounded-full bg-fill text-accent hover:bg-fill-2"
          aria-label={`Dial ${fmtPhone(r.phone)}`}
          title={fmtPhone(r.phone)}
        >
          <Phone className="size-4" />
        </a>
        <Link
          href={`/calls/${r.parent_id}`}
          className="inline-flex h-9 items-center gap-1 rounded-full bg-accent px-3.5 text-footnote font-semibold text-accent-ink"
        >
          {r.state === "due" ? "Call" : "Open"} <ChevronRight className="size-3.5" />
        </Link>
      </div>
      {action.state.error && (
        <div className="w-full pl-11">
          <FormError message={action.state.error} />
        </div>
      )}
    </li>
  );
}

function CalledToday({ d }: { d: CallBoard }) {
  const [onlyMine, setOnlyMine] = useState(false);
  const calls = onlyMine ? d.calls_today.filter((c) => c.caller_id === d.me.id) : d.calls_today;
  return (
    <Card
      bodyClassName="p-2 sm:p-3"
      title={`${calls.length} ${calls.length === 1 ? "call" : "calls"} today`}
      actions={
        <label className="flex items-center gap-2 text-footnote text-ink-2">
          <input type="checkbox" checked={onlyMine} onChange={(e) => setOnlyMine(e.target.checked)} className="size-4 accent-[var(--accent)]" /> Only mine
        </label>
      }
    >
      {calls.length === 0 ? (
        <Empty title="No calls yet today" icon={PhoneCall} />
      ) : (
        <ul className="divide-y divide-line">
          {calls.map((c) => (
            <li key={c.id} className="flex items-start gap-3 px-3 py-3">
              <span
                className={cn(
                  "mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-full text-white",
                  c.outcome === "connected" ? "bg-tile-blue" : "bg-tile-gray",
                )}
                aria-hidden
              >
                {c.outcome === "connected" ? <PhoneCall className="size-4" /> : <PhoneMissed className="size-4" />}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <Link href={`/parents/${c.parent_id}`} className="text-subhead font-semibold text-ink hover:text-accent">
                    {c.parent_name}
                  </Link>
                  <Badge tone={c.purpose === "fees" ? "accent" : "neutral"}>{PURPOSE_LABELS[c.purpose].short}</Badge>
                  <span className="text-footnote text-ink-2">
                    {OUTCOME_LABELS[c.outcome]}
                    {c.response ? ` · ${RESPONSE_LABELS[c.response]}` : ""}
                  </span>
                </div>
                {c.summary && <p className="mt-0.5 text-footnote text-ink">{c.summary}</p>}
                {c.promised_date && (
                  <p className="mt-0.5 text-footnote font-medium text-ink">
                    Promised {c.promised_amount ? rupees(c.promised_amount) : "to pay"} by {fmtDate(c.promised_date)}
                  </p>
                )}
                <p className="mt-0.5 text-caption text-muted">
                  {fmtTime(c.called_at)} · {c.caller_name ?? "Staff"}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** Log a call to any family (a parent's question, a PTM reminder…): find the student, open their family. */
function CallAnyFamily() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!open) {
    return (
      <Button onClick={() => setOpen(true)}>
        <PhoneCall className="size-4" /> Call any family
      </Button>
    );
  }
  return (
    <div className="w-full max-w-sm space-y-1">
      <StudentSearch
        mode="pick"
        autoFocus
        placeholder="Find the student whose family to call…"
        onPick={async (s) => {
          setError(null);
          try {
            const r = await apiFetch<StudentRecovery>(`/api/students/${s.id}/recovery`);
            if (r.parent) router.push(`/calls/${r.parent.id}`);
            else setError(`${s.full_name} has no family linked yet: add the parent's phone number to the student.`);
          } catch {
            setError("Could not open the family. Try again.");
          }
        }}
      />
      {error ? (
        <FormError message={error} />
      ) : (
        <p className="flex items-center gap-1 text-caption text-muted">
          <Info className="size-3" /> For calls about anything: fees, studies, PTM or a parent&rsquo;s question.
        </p>
      )}
    </div>
  );
}
