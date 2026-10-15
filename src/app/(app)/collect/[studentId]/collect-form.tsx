"use client";

import Link from "next/link";
import { useActionState, useMemo, useState } from "react";
import { Banknote, Building2, Check, CreditCard, FileCheck2, MoreHorizontal, Smartphone } from "lucide-react";
import { collectPayment } from "./actions";
import type { ActionState } from "@/lib/action-state";
import type { DueLine, PaymentMode } from "@/lib/types";
import { fmtDate, parseRupees, pct, rupees, rupeesShort } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Field, FormError, Input, Textarea } from "@/components/ui/form";
import { Badge } from "@/components/ui/badge";
import { StackedBar, Legend } from "@/components/ui/bars";
import { KIND_LEGEND } from "@/components/ui/alloc";
import { cn } from "@/lib/cn";

type SessionLite = { id: string; start: string; end: string; name: string };

/** Default allocation rule, mirroring the database engine (used for the preview; the DB stores what you confirm). */
function autoAllocate(amount: number, dues: DueLine[], order: "oldest_first" | "current_first", paySessionId: string | null) {
  const out = new Map<string, number>();
  let left = amount;
  const ordered =
    order === "current_first" && paySessionId
      ? [...dues.filter((d) => d.session_id === paySessionId), ...dues.filter((d) => d.session_id !== paySessionId)]
      : dues;
  for (const d of ordered) {
    if (left <= 0) break;
    const a = Math.min(d.remaining, left);
    if (a > 0) {
      out.set(d.charge_id, a);
      left -= a;
    }
  }
  return out;
}

const MODES: { value: PaymentMode; label: string; icon: React.ElementType; ref?: string }[] = [
  { value: "cash", label: "Cash", icon: Banknote },
  { value: "upi", label: "UPI", icon: Smartphone, ref: "UPI transaction ID" },
  { value: "cheque", label: "Cheque", icon: FileCheck2, ref: "Cheque number & bank" },
  { value: "bank_transfer", label: "Bank", icon: Building2, ref: "UTR / NEFT reference" },
  { value: "card", label: "Card", icon: CreditCard, ref: "Card slip / approval code" },
  { value: "other", label: "Other", icon: MoreHorizontal, ref: "Reference" },
];

export function CollectForm({
  studentId,
  dues,
  today,
  advance,
  order,
  sessions,
  recent,
}: {
  studentId: string;
  dues: DueLine[];
  today: string;
  advance: number;
  order: "oldest_first" | "current_first";
  sessions: SessionLite[];
  recent: { id: string; receipt_no: string; paid_on: string; amount: number; cancelled: boolean }[];
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(collectPayment, {});
  const [amountText, setAmountText] = useState("");
  const [paidOn, setPaidOn] = useState(today);
  const [mode, setMode] = useState<PaymentMode>("cash");
  const [manual, setManual] = useState(false);
  const [lines, setLines] = useState<Record<string, string>>({});
  const [showNote, setShowNote] = useState(false);

  const paySession = sessions.find((s) => paidOn >= s.start && paidOn <= s.end) ?? null;
  const paySessionStart = paySession?.start ?? "";
  const amount = parseRupees(amountText) ?? 0;
  const totalDue = dues.reduce((a, d) => a + d.remaining, 0);
  const overdueLines = dues.filter((d) => d.is_overdue);
  const totalOverdue = overdueLines.reduce((a, d) => a + d.remaining, 0);
  const modeInfo = MODES.find((m) => m.value === mode)!;

  const allocation = useMemo(() => {
    if (!manual) return autoAllocate(amount, dues, order, paySession?.id ?? null);
    const m = new Map<string, number>();
    for (const d of dues) {
      const v = parseRupees(lines[d.charge_id] ?? "");
      if (v && v > 0) m.set(d.charge_id, Math.min(v, d.remaining));
    }
    return m;
  }, [manual, amount, dues, order, paySession?.id, lines]);

  const allocated = [...allocation.values()].reduce((a, v) => a + v, 0);
  const unallocated = Math.max(0, amount - allocated);
  const kindOf = (sessionId: string, sessionStart: string) => (sessionId === paySession?.id ? "current" : sessionStart < paySessionStart ? "arrears" : "advance");
  const split = { current: 0, arrears: 0, advance: 0 };
  for (const d of dues) {
    const a = allocation.get(d.charge_id) ?? 0;
    if (a > 0) split[kindOf(d.session_id, d.session_start)] += a;
  }
  if (!manual) split.advance += unallocated;
  const over = manual && allocated > amount;

  const groups = useMemo(() => {
    const g: { key: string; session: string; sessionId: string; sessionStart: string; inst: string; instNo: number; due: string; overdue: boolean; lines: DueLine[] }[] = [];
    for (const d of dues) {
      const key = `${d.session_id}|${d.installment_id}`;
      let grp = g.find((x) => x.key === key);
      if (!grp) {
        grp = { key, session: d.session_name, sessionId: d.session_id, sessionStart: d.session_start, inst: d.installment_name, instNo: d.installment_no, due: d.due_date, overdue: d.is_overdue, lines: [] };
        g.push(grp);
      }
      grp.lines.push(d);
    }
    return g;
  }, [dues]);

  function fillManual(selected: DueLine[], additive = false) {
    const next: Record<string, string> = additive ? { ...lines } : {};
    for (const d of selected) next[d.charge_id] = String(d.remaining / 100);
    setLines(next);
    setManual(true);
    const sum = dues.reduce((a, d) => a + Math.min(parseRupees(next[d.charge_id] ?? "") ?? 0, d.remaining), 0);
    setAmountText(String(sum / 100));
  }

  const targets = [...allocation.entries()].map(([charge_id, amt]) => ({ charge_id, amount: amt }));

  return (
    <form action={action} className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_400px]">
      <input type="hidden" name="student_id" value={studentId} />
      <input type="hidden" name="targets" value={JSON.stringify(targets)} />
      <input type="hidden" name="mode" value={mode} />

      <section className="rounded-[var(--radius-card)] bg-surface shadow-card">
        <header className="flex flex-wrap items-end justify-between gap-3 px-5 pt-5 sm:px-6">
          <div>
            <h2 className="text-headline font-semibold text-ink">Open dues</h2>
            <p className="mt-0.5 text-footnote text-ink-2">
              <span className="font-semibold text-ink">{rupees(totalDue)}</span> unpaid
              {totalOverdue > 0 && (
                <>
                  {" "}· <span className="font-semibold text-critical-ink">{rupees(totalOverdue)}</span> overdue
                </>
              )}
              {advance > 0 && <> · {rupees(advance)} advance held</>}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {totalOverdue > 0 && (
              <Button type="button" size="sm" onClick={() => fillManual(overdueLines)}>
                Pay overdue
              </Button>
            )}
            {totalDue > 0 && (
              <Button type="button" size="sm" onClick={() => fillManual(dues)}>
                Pay everything
              </Button>
            )}
          </div>
        </header>

        <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-4 sm:px-6">
          <div className="inline-flex rounded-[10px] bg-fill p-[2px] text-footnote" role="group" aria-label="Allocation">
            {[
              { v: false, label: "Automatic" },
              { v: true, label: "Choose" },
            ].map((o) => (
              <button
                key={o.label}
                type="button"
                aria-pressed={manual === o.v}
                onClick={() => {
                  if (o.v && !manual) {
                    const seed: Record<string, string> = {};
                    for (const [k, v] of allocation) seed[k] = String(v / 100);
                    setLines(seed);
                  }
                  setManual(o.v);
                }}
                className={cn(
                  "rounded-[8px] px-3 py-[5px] font-medium transition-all",
                  manual === o.v ? "bg-surface text-ink shadow-[0_1px_3px_rgba(0,0,0,0.12)] dark:bg-surface-3" : "text-ink-2",
                )}
              >
                {o.label}
              </button>
            ))}
          </div>
          <span className="text-caption text-muted">{manual ? "Type what each fee gets" : order === "oldest_first" ? "Oldest dues are cleared first" : "This session is cleared first"}</span>
        </div>

        {dues.length === 0 ? (
          <p className="px-6 py-14 text-center text-subhead text-ink-2">No dues. Anything collected now is kept as an advance.</p>
        ) : (
          <div className="space-y-3 p-5 sm:p-6">
            {groups.map((g) => {
              const kind = kindOf(g.sessionId, g.sessionStart);
              const pendingTotal = g.lines.reduce((a, l) => a + l.remaining, 0);
              const allocatedHere = g.lines.reduce((a, l) => a + (allocation.get(l.charge_id) ?? 0), 0);
              const full = allocatedHere >= pendingTotal && pendingTotal > 0;
              const dot = { current: "bg-series-1", arrears: "bg-series-2", advance: "bg-series-3" }[kind];
              return (
                <div key={g.key} className={cn("rounded-2xl border p-4 transition-colors", allocatedHere > 0 ? "border-accent/40 bg-accent-soft/40" : "border-line bg-fill-2/60")}>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                    <button
                      type="button"
                      onClick={() => fillManual(g.lines, true)}
                      aria-label={`Pay all of ${g.session} ${g.inst}`}
                      className={cn(
                        "inline-flex size-6 shrink-0 items-center justify-center rounded-full border-2 transition-colors",
                        full ? "border-accent bg-accent text-white" : "border-line-strong text-transparent hover:border-accent",
                      )}
                    >
                      <Check className="size-3.5" strokeWidth={3} />
                    </button>
                    <span className={cn("size-2 rounded-full", dot)} aria-hidden />
                    <span className="text-subhead font-semibold text-ink">
                      {g.session} · {g.inst}
                    </span>
                    {kind === "arrears" && <Badge tone="serious">Old dues</Badge>}
                    {g.overdue ? <Badge tone="critical">Overdue</Badge> : <Badge>Due {fmtDate(g.due)}</Badge>}
                    <span className="ml-auto text-subhead tabular">
                      {allocatedHere > 0 && <span className="mr-2 font-semibold text-accent">{rupees(allocatedHere)}</span>}
                      <span className={allocatedHere > 0 ? "text-muted" : "font-semibold text-ink"}>{rupees(pendingTotal)}</span>
                    </span>
                  </div>
                  <ul className="mt-3 space-y-1.5 pl-9">
                    {g.lines.map((l) => {
                      const a = allocation.get(l.charge_id) ?? 0;
                      return (
                        <li key={l.charge_id} className="flex items-center justify-between gap-3 text-subhead">
                          <span className="min-w-0 truncate text-ink-2">
                            {l.fee_head}
                            {l.concession > 0 && <span className="ml-1 text-caption text-muted">(−{rupeesShort(l.concession)})</span>}
                          </span>
                          <span className="flex items-center gap-3 tabular">
                            <span className="text-muted">{rupees(l.remaining)}</span>
                            {manual ? (
                              <input
                                inputMode="decimal"
                                aria-label={`Amount for ${g.inst} ${l.fee_head}`}
                                value={lines[l.charge_id] ?? ""}
                                onChange={(e) => setLines((s) => ({ ...s, [l.charge_id]: e.target.value }))}
                                placeholder="0"
                                className="h-8 w-24 rounded-lg bg-surface px-2 text-right text-subhead text-ink shadow-[0_0_0_1px_var(--line-strong)] focus:outline-none focus:ring-4 focus:ring-accent/15"
                              />
                            ) : (
                              <span className={cn("w-20 text-right", a > 0 ? "font-semibold text-accent" : "text-transparent")}>{a > 0 ? rupees(a) : "—"}</span>
                            )}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <aside className="space-y-4 xl:sticky xl:top-20 xl:self-start">
        <section className="rounded-[var(--radius-card)] bg-surface p-5 shadow-card sm:p-6">
          <label htmlFor="amount" className="text-footnote font-medium text-ink-2">
            Amount received
          </label>
          <div className="relative mt-1.5">
            <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-title1 font-semibold text-muted">₹</span>
            <input
              id="amount"
              name="amount"
              inputMode="decimal"
              autoFocus
              required
              autoComplete="off"
              value={amountText}
              onChange={(e) => setAmountText(e.target.value)}
              placeholder="0"
              className="figure h-16 w-full rounded-2xl bg-fill-2 pl-11 pr-4 text-[32px] text-ink placeholder:text-muted/60 focus:bg-surface focus:outline-none focus:ring-4 focus:ring-accent/15"
            />
          </div>

          <p className="mb-2 mt-5 text-footnote font-medium text-ink-2">Paid by</p>
          <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Payment mode">
            {MODES.map((m) => {
              const Icon = m.icon;
              const active = m.value === mode;
              return (
                <button
                  key={m.value}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => setMode(m.value)}
                  className={cn(
                    "flex flex-col items-center gap-1 rounded-2xl py-2.5 text-caption font-semibold transition-all",
                    active ? "bg-accent text-accent-ink shadow-[0_2px_8px_rgba(0,113,227,0.3)]" : "bg-fill-2 text-ink-2 hover:bg-fill",
                  )}
                >
                  <Icon className="size-5" strokeWidth={2} />
                  {m.label}
                </button>
              );
            })}
          </div>

          <div className="mt-4 grid grid-cols-1 gap-3">
            {mode !== "cash" && (
              <Field label={modeInfo.ref ?? "Reference"} htmlFor="reference_no">
                <Input id="reference_no" name="reference_no" required={mode !== "card" && mode !== "other"} />
              </Field>
            )}
            <Field label="Date" htmlFor="paid_on">
              <Input id="paid_on" name="paid_on" type="date" max={today} value={paidOn} onChange={(e) => setPaidOn(e.target.value)} required />
            </Field>
            {showNote ? (
              <Field label="Remarks" htmlFor="remarks">
                <Textarea id="remarks" name="remarks" rows={2} autoFocus />
              </Field>
            ) : (
              <button type="button" onClick={() => setShowNote(true)} className="justify-self-start text-footnote font-medium text-accent">
                + Add a remark
              </button>
            )}
          </div>

          {amount > 0 && (
            <div className="mt-5 rounded-2xl bg-fill-2 p-4">
              <StackedBar
                segments={[
                  { value: split.current, className: "bg-series-1", label: "This year", display: rupees(split.current) },
                  { value: split.arrears, className: "bg-series-2", label: "Old dues", display: rupees(split.arrears) },
                  { value: split.advance, className: "bg-series-3", label: "Advance", display: rupees(split.advance) },
                ]}
              />
              <Legend
                className="mt-3"
                items={[
                  { ...KIND_LEGEND[0], value: rupeesShort(split.current) },
                  { ...KIND_LEGEND[1], value: rupeesShort(split.arrears) },
                  { ...KIND_LEGEND[2], value: rupeesShort(split.advance) },
                ]}
              />
              <div className="mt-3 flex items-baseline justify-between border-t border-line pt-3 text-subhead">
                <span className="text-ink-2">Balance after</span>
                <span className="font-semibold tabular">{rupees(Math.max(0, totalDue - Math.min(amount, totalDue)))}</span>
              </div>
              {totalDue > 0 && <p className="mt-0.5 text-right text-caption text-muted">clears {pct((100 * Math.min(amount, totalDue)) / totalDue, 0)} of the balance</p>}
              {manual && unallocated > 0 && <p className="mt-1 text-caption text-muted">{rupees(unallocated)} not assigned goes to the oldest dues or advance.</p>}
            </div>
          )}

          <div className="mt-4 space-y-2">
            {over && <FormError message={`You assigned ${rupees(allocated)}, more than the ${rupees(amount)} received.`} />}
            {!paySession && <FormError message="No academic session covers this date." />}
            <FormError message={state.error} />
          </div>
          <Button type="submit" variant="primary" size="lg" className="mt-4 w-full" disabled={pending || amount <= 0 || over || !paySession}>
            {pending ? "Saving…" : amount > 0 ? `Collect ${rupees(amount)}` : "Enter an amount"}
          </Button>
        </section>

        {recent.length > 0 && (
          <section className="rounded-[var(--radius-card)] bg-surface p-5 shadow-card">
            <h3 className="mb-2 text-footnote font-medium text-ink-2">Recent receipts</h3>
            <ul className="space-y-1.5 text-subhead">
              {recent.map((r) => (
                <li key={r.id} className="flex justify-between gap-2">
                  <Link href={`/payments/${r.id}`} className="text-accent">
                    {r.receipt_no}
                  </Link>
                  <span className="tabular text-ink-2">
                    {fmtDate(r.paid_on)} · <span className={r.cancelled ? "line-through" : "font-medium text-ink"}>{rupees(r.amount)}</span>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </aside>
    </form>
  );
}
