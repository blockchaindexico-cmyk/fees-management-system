import Link from "next/link";
import { notFound } from "next/navigation";
import { CheckCircle2, IndianRupee, Pencil, Phone, Receipt, Wallet, Clock, AlertTriangle } from "lucide-react";
import { requireStaff, canWrite } from "@/lib/auth";
import { param } from "@/lib/context";
import { createClient } from "@/lib/supabase/server";
import { MODE_LABELS, fmtDate, fmtDateTime, pct, ratioPct, rupees, rupeesShort } from "@/lib/format";
import type { Student360 } from "@/lib/types";
import { Breadcrumbs } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { LinkButton } from "@/components/ui/button";
import { FeeStatusBadge } from "@/components/ui/status";
import { AllocLines } from "@/components/ui/alloc";
import { Meter, StackedBar } from "@/components/ui/bars";
import { Segmented } from "@/components/ui/segmented";
import { Empty } from "@/components/ui/empty";
import { Avatar } from "@/components/ui/avatar";
import { IconTile } from "@/components/ui/kpi";
import { Ring } from "@/components/ui/ring";
import { cn } from "@/lib/cn";
import { NoteForm, DeleteNoteButton } from "./note-form";

export const metadata = { title: "Student" };

const INST_STATUS = {
  paid: { label: "Paid", tone: "good", color: "var(--good)" },
  partial: { label: "Part paid", tone: "warning", color: "var(--series-1)" },
  partial_overdue: { label: "Overdue", tone: "critical", color: "var(--critical)" },
  overdue: { label: "Overdue", tone: "critical", color: "var(--critical)" },
  upcoming: { label: "Upcoming", tone: "neutral", color: "var(--series-1)" },
  waived: { label: "Waived", tone: "neutral", color: "var(--tile-gray)" },
} as const;

const PROFILE = {
  early: { label: "Pays early", hint: "Usually before the due date", tone: "text-good-ink" },
  on_time: { label: "Pays on time", hint: "Usually within two weeks of the due date", tone: "text-good-ink" },
  late: { label: "Pays late", hint: "Usually more than two weeks after the due date", tone: "text-serious-ink" },
  year_end: { label: "Pays at year end", hint: "Most money arrives January–March", tone: "text-serious-ink" },
  no_history: { label: "No history yet", hint: "Nothing paid against fees yet", tone: "text-ink-2" },
} as const;

export default async function Student360Page({ params, searchParams }: PageProps<"/students/[id]">) {
  const viewer = await requireStaff();
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("student_360", { p_student: id });
  if (error?.message?.includes("not found")) notFound();
  if (error || !data) throw new Error(error?.message ?? "Could not load student");
  const d = data as Student360;
  const st = d.student;
  const writer = canWrite(viewer.role);
  const b = d.balance;
  const currentEnr = d.enrollments.find((e) => e.is_current) ?? d.enrollments[0];
  const ladderSessionId = param(sp.session) ?? d.sessions.find((s) => s.is_current)?.session_id ?? d.sessions[0]?.session_id;
  const ladder = d.sessions.find((s) => s.session_id === ladderSessionId);
  const totalOutstanding = d.sessions.reduce((a, s) => a + s.remaining, 0);
  const lp = d.last_payment;
  const supposed = b ? b.expected + b.prev_opening : 0;
  const paid = b ? b.received + b.prev_recovered : 0;

  return (
    <div className="space-y-5">
      <Breadcrumbs items={[{ label: "Students", href: "/students" }, ...(currentEnr ? [{ label: currentEnr.class_name, href: `/classes/${currentEnr.class_id}` }] : [])]} />

      {/* Profile header */}
      <section className="flex flex-col gap-5 rounded-[28px] bg-surface p-6 shadow-card sm:flex-row sm:items-center sm:p-7">
        <Avatar name={st.full_name} size="xl" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-title1 font-bold text-ink">{st.full_name}</h1>
            <FeeStatusBadge status={d.fee_status} />
            {st.status !== "active" && <Badge>{st.status === "left" ? `Left ${fmtDate(st.left_on)}` : "Passed out"}</Badge>}
          </div>
          <p className="mt-1 text-subhead text-ink-2">
            {[currentEnr ? `${currentEnr.class_name} · ${currentEnr.section}${currentEnr.roll_no ? ` · Roll ${currentEnr.roll_no}` : ""}` : null, st.admission_no, st.father_name]
              .filter(Boolean)
              .join("  ·  ")}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {st.phone && (
            <a href={`tel:${st.phone}`} className="inline-flex h-9 items-center gap-1.5 rounded-full bg-fill px-4 text-subhead font-medium text-ink transition-colors hover:bg-[rgba(118,118,128,0.18)]">
              <Phone className="size-4" /> {st.phone}
            </a>
          )}
          {writer && (
            <>
              <LinkButton href={`/students/${id}/fees`}>
                <Receipt className="size-4" /> Fee plan
              </LinkButton>
              <LinkButton href={`/students/${id}/edit`} aria-label="Edit student">
                <Pencil className="size-4" />
              </LinkButton>
              <LinkButton href={`/collect/${id}`} variant="primary">
                <IndianRupee className="size-4" /> Collect
              </LinkButton>
            </>
          )}
        </div>
      </section>

      {/* The four answers */}
      {b && (
        <div className="grid grid-cols-1 gap-4 min-[560px]:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-[var(--radius-card)] bg-surface p-5 shadow-card">
            <p className="flex items-center gap-2.5 text-subhead font-medium text-ink-2">
              <IconTile icon={Wallet} color="blue" size="sm" /> Should pay
            </p>
            <p className="figure mt-3 text-[28px] leading-none">{rupeesShort(supposed)}</p>
            <p className="mt-2.5 text-footnote text-ink-2">
              {b.prev_opening > 0 ? <>incl. {rupeesShort(b.prev_opening)} old dues</> : b.session_name}
              {b.concession > 0 && <> · {rupeesShort(b.concession)} concession</>}
            </p>
          </div>
          <div className="rounded-[var(--radius-card)] bg-surface p-5 shadow-card">
            <p className="flex items-center gap-2.5 text-subhead font-medium text-ink-2">
              <IconTile icon={CheckCircle2} color="green" size="sm" /> Has paid
            </p>
            <p className="figure mt-3 text-[28px] leading-none">{rupeesShort(paid)}</p>
            <Meter value={ratioPct(paid, supposed)} className="mt-3.5" color="bg-good" track="bg-good-soft" />
            <p className="mt-2.5 text-footnote text-ink-2">{pct(ratioPct(paid, supposed), 0)} of what was due</p>
          </div>
          <div className="rounded-[var(--radius-card)] bg-surface p-5 shadow-card">
            <p className="flex items-center gap-2.5 text-subhead font-medium text-ink-2">
              <IconTile icon={Clock} color="indigo" size="sm" /> Last payment
            </p>
            {lp ? (
              <>
                <p className="figure mt-3 text-[28px] leading-none">{rupeesShort(lp.amount)}</p>
                <div className="mt-3.5">
                  <StackedBar
                    height="h-1.5"
                    segments={[
                      { value: lp.current, className: "bg-series-1", label: "This year", display: rupees(lp.current) },
                      { value: lp.arrears, className: "bg-series-2", label: "Old dues", display: rupees(lp.arrears) },
                      { value: lp.advance, className: "bg-series-3", label: "Advance", display: rupees(lp.advance) },
                    ]}
                  />
                </div>
                <p className="mt-2.5 text-footnote text-ink-2">
                  {fmtDate(lp.paid_on)} · {lp.arrears > 0 && lp.current === 0 ? "went to old dues" : lp.arrears > 0 ? "this year + old dues" : lp.advance > 0 && lp.current === 0 ? "kept as advance" : "went to this year"}
                </p>
              </>
            ) : (
              <p className="mt-3 text-headline font-semibold text-critical-ink">Never paid</p>
            )}
          </div>
          <div className={cn("rounded-[var(--radius-card)] p-5 shadow-card", b.total_pending > 0 ? "bg-surface" : "bg-surface")}>
            <p className="flex items-center gap-2.5 text-subhead font-medium text-ink-2">
              <IconTile icon={AlertTriangle} color={b.total_overdue > 0 ? "red" : "green"} size="sm" /> Still owes
            </p>
            <p className={cn("figure mt-3 text-[28px] leading-none", b.total_pending > 0 ? "text-critical-ink" : "text-good-ink")}>{rupeesShort(b.total_pending)}</p>
            <p className="mt-2.5 text-footnote text-ink-2">
              {b.total_overdue > 0 ? <>{rupeesShort(b.total_overdue)} overdue now</> : "Nothing overdue"}
              {b.advance_balance > 0 && <> · {rupeesShort(b.advance_balance)} advance</>}
            </p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <div className="space-y-5 xl:col-span-2">
          <Card
            title="Installments"
            subtitle={ladder ? `${ladder.session_name}${ladder.class_name ? ` · ${ladder.class_name}` : ""}` : undefined}
            actions={
              d.sessions.length > 1 ? (
                <Segmented size="sm" options={d.sessions.map((s) => ({ label: s.session_name, href: `/students/${id}?session=${s.session_id}`, active: s.session_id === ladderSessionId }))} />
              ) : undefined
            }
          >
            {!ladder ? (
              <Empty title="No fee plan">
                {writer ? <Link href={`/students/${id}/fees`} className="text-accent">Set up the fee plan</Link> : "No charges set for this student."}
              </Empty>
            ) : (
              <>
                <ol className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  {ladder.installments.map((i) => {
                    const s = INST_STATUS[i.status];
                    return (
                      <li key={i.installment_id} className="rounded-2xl bg-fill-2 p-4">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-subhead font-semibold text-ink">{i.name}</span>
                          <Badge tone={s.tone}>{s.label}</Badge>
                        </div>
                        <div className="mt-4 flex items-center gap-4">
                          <Ring value={ratioPct(i.paid, i.net) ?? (i.net === 0 ? 100 : 0)} size={64} stroke={7} color={s.color}>
                            <span className="text-caption font-semibold tabular">{i.net > 0 ? `${Math.round(ratioPct(i.paid, i.net) ?? 0)}%` : "—"}</span>
                          </Ring>
                          <div>
                            <p className={cn("text-headline font-semibold tabular", i.remaining > 0 && i.due_date <= d.today ? "text-critical-ink" : "text-ink")}>
                              {i.remaining > 0 ? rupeesShort(i.remaining) : "Clear"}
                            </p>
                            <p className="text-caption text-muted">{i.remaining > 0 ? "left to pay" : `${rupeesShort(i.paid)} paid`}</p>
                          </div>
                        </div>
                        <p className="mt-3 text-caption text-muted">
                          Due {fmtDate(i.due_date)} · {rupeesShort(i.net)}
                        </p>
                        <details className="mt-2 text-caption">
                          <summary className="cursor-pointer text-accent">Fee heads</summary>
                          <ul className="mt-2 space-y-1">
                            {i.lines.map((l) => (
                              <li key={l.charge_id} className="flex justify-between gap-2 tabular">
                                <span className="text-ink-2">{l.fee_head}</span>
                                <span className={l.remaining > 0 ? "text-ink" : "text-muted"}>{l.remaining > 0 ? rupees(l.remaining) : "paid"}</span>
                              </li>
                            ))}
                          </ul>
                        </details>
                      </li>
                    );
                  })}
                </ol>
              </>
            )}
          </Card>

          <Card title="Payments" description="Every receipt and exactly what it paid for. % = share of the outstanding balance that the payment cleared.">
            {d.payments.length === 0 ? (
              <Empty title="No payments yet" />
            ) : (
              <ol className="relative space-y-1 before:absolute before:bottom-2 before:left-[19px] before:top-2 before:w-px before:bg-line">
                {d.payments.map((p) => (
                  <li key={p.payment_id} className="relative flex gap-4 rounded-2xl py-2.5 pr-2">
                    <span
                      className={cn(
                        "relative z-10 mt-0.5 inline-flex size-10 shrink-0 items-center justify-center rounded-full text-white",
                        p.is_reversal ? "bg-tile-gray" : p.cancelled ? "bg-critical" : "bg-good",
                      )}
                      aria-hidden
                    >
                      <IndianRupee className="size-4" strokeWidth={2.4} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                        <span className={cn("text-headline font-semibold tabular", p.amount < 0 && "text-critical-ink", p.cancelled && "line-through decoration-1")}>{rupees(p.amount)}</span>
                        <span className="text-footnote text-muted">{fmtDate(p.paid_on)}</span>
                      </div>
                      <p className="text-caption text-muted">
                        <Link href={`/payments/${p.payment_id}`} className="font-medium text-accent">
                          {p.receipt_no}
                        </Link>
                        {" · "}
                        {MODE_LABELS[p.mode]}
                        {p.pct_of_outstanding !== null && <> · cleared {pct(p.pct_of_outstanding, 0)} of balance</>}
                        {p.cancelled && <span className="font-semibold text-critical-ink"> · cancelled</span>}
                        {p.is_reversal && <span className="font-semibold text-ink-2"> · cancellation</span>}
                      </p>
                      <div className="mt-2">
                        <AllocLines lines={p.allocations} compact />
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </div>

        <div className="space-y-5">
          <Card title="By session">
            <ul className="space-y-3">
              {d.sessions.map((s) => (
                <li key={s.session_id}>
                  <div className="flex items-baseline justify-between gap-2 text-subhead">
                    <span className="font-medium text-ink">
                      {s.session_name} <span className="text-caption font-normal text-muted">{s.class_name ?? ""}</span>
                    </span>
                    <span className={cn("font-semibold tabular", s.remaining > 0 ? "text-critical-ink" : "text-good-ink")}>{s.remaining > 0 ? rupeesShort(s.remaining) : "Clear"}</span>
                  </div>
                  <Meter value={ratioPct(s.paid, s.net)} className="mt-1.5" color={s.remaining > 0 ? "bg-series-1" : "bg-good"} track="bg-fill-2" />
                </li>
              ))}
            </ul>
            <div className="mt-4 flex justify-between border-t border-line pt-3 text-subhead">
              <span className="text-ink-2">Total owed</span>
              <span className="font-semibold tabular">{rupees(totalOutstanding)}</span>
            </div>
          </Card>

          <Card title="Payment habit" description="Based on when money reached each installment compared with its due date.">
            <p className={cn("text-title2 font-semibold", PROFILE[d.behaviour.profile].tone)}>{PROFILE[d.behaviour.profile].label}</p>
            <p className="text-footnote text-ink-2">{PROFILE[d.behaviour.profile].hint}</p>
            {d.behaviour.profile !== "no_history" && (
              <dl className="mt-4 grid grid-cols-3 gap-2 rounded-2xl bg-fill-2 p-3 text-center">
                <div>
                  <dd className="text-headline font-semibold tabular">
                    {d.behaviour.avg_days_from_due === null ? "—" : d.behaviour.avg_days_from_due <= 0 ? `${Math.abs(d.behaviour.avg_days_from_due)}d` : `+${d.behaviour.avg_days_from_due}d`}
                  </dd>
                  <dt className="text-caption text-muted">vs due date</dt>
                </div>
                <div>
                  <dd className="text-headline font-semibold tabular">{pct(d.behaviour.on_time_pct, 0)}</dd>
                  <dt className="text-caption text-muted">on time</dt>
                </div>
                <div>
                  <dd className="text-headline font-semibold tabular">{pct(d.behaviour.year_end_pct, 0)}</dd>
                  <dt className="text-caption text-muted">in Jan–Mar</dt>
                </div>
              </dl>
            )}
          </Card>

          <Card title="Notes">
            {writer && <NoteForm studentId={id} />}
            <ul className={cn("space-y-2.5", writer && "mt-4")}>
              {d.notes.length === 0 && <li className="text-footnote text-muted">No notes yet.</li>}
              {d.notes.map((n) => (
                <li key={n.id} className="rounded-2xl bg-fill-2 p-3.5 text-subhead">
                  <div className="flex items-start justify-between gap-2">
                    <p className="whitespace-pre-wrap text-ink">{n.note}</p>
                    {writer && <DeleteNoteButton id={n.id} studentId={id} />}
                  </div>
                  {(n.promised_date || n.promised_amount) && (
                    <p className={cn("mt-1.5 text-footnote font-semibold", n.promised_date && n.promised_date < d.today ? "text-critical-ink" : "text-accent")}>
                      Promised {n.promised_amount ? rupees(n.promised_amount) : "payment"}
                      {n.promised_date ? ` by ${fmtDate(n.promised_date)}` : ""}
                      {n.promised_date && n.promised_date < d.today ? " · passed" : ""}
                    </p>
                  )}
                  <p className="mt-1 text-caption text-muted">
                    {n.author ?? "Staff"} · {fmtDateTime(n.created_at)}
                  </p>
                </li>
              ))}
            </ul>
          </Card>

          <Card title="Details">
            <dl className="space-y-2.5 text-subhead">
              {[
                ["Phone", [st.phone, st.alt_phone].filter(Boolean).join(", ") || "—"],
                ["Mother", st.mother_name ?? "—"],
                ["Address", st.address ?? "—"],
                ["Born", fmtDate(st.dob)],
                ["Admitted", fmtDate(st.admission_date)],
                ["History", d.enrollments.map((e) => `${e.session_name}: ${e.class_name}`).join(" · ") || "—"],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between gap-4">
                  <dt className="shrink-0 text-ink-2">{k}</dt>
                  <dd className="text-right text-ink">{v}</dd>
                </div>
              ))}
            </dl>
          </Card>
        </div>
      </div>
    </div>
  );
}
