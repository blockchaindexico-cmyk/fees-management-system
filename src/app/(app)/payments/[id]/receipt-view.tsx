"use client";

import Link from "next/link";
import { CheckCircle2, IndianRupee } from "lucide-react";
import { param, type SearchParams } from "@/lib/context";
import { useApi } from "@/lib/api/hooks";
import { MODE_LABELS, fmtDate, fmtDateTime, rupees, rupeesInWords } from "@/lib/format";
import type { ReceiptData } from "@/lib/types";
import { useApp } from "@/components/layout/app-shell";
import { NotFoundCard, Pending } from "@/components/ui/page-state";
import { LinkButton } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CancelReceipt, ReceiptSource } from "./receipt-actions";
import { PrintButton } from "@/components/ui/print-button";
import { cn } from "@/lib/cn";

export function ReceiptView({ id, sp }: { id: string; sp: SearchParams }) {
  const { settings, writer } = useApp();
  const res = useApi<ReceiptData>(`/api/payments/${id}`);
  if (!res.data) return <Pending queries={[res]} />;
  const { payment: pay, student: d, reversal } = res.data;
  const p = d.payments.find((x) => x.payment_id === id);
  if (!p) return <NotFoundCard />;
  const enr = d.enrollments.find((e) => e.session_name === p.session_name) ?? d.enrollments[0];
  const original = pay.reverses_payment_id ? d.payments.find((x) => x.payment_id === pay.reverses_payment_id) : null;
  const toDues = p.allocations.filter((a) => a.installment).reduce((s, a) => s + a.amount, 0);
  const balanceAfter = Math.max(0, p.outstanding_before - toDues);
  const nowOutstanding = d.sessions.reduce((s, x) => s + x.remaining, 0);
  const copies = param(sp.copies) === "2" ? ["Parent copy", "Office copy"] : [null];
  const isNew = param(sp.new) === "1";
  const creatorName = pay.created_by_name;

  return (
    <>
      <div className="no-print mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          {isNew && (
            <p className="mb-1 inline-flex items-center gap-1.5 text-sm font-medium text-good-ink">
              <CheckCircle2 className="size-4" /> Payment saved
            </p>
          )}
          <h1 className="text-title1 font-bold text-ink">{p.receipt_no}</h1>
          <p className="text-footnote text-ink-2">
            <Link href={`/students/${d.student.id}`} className="hover:underline">
              {d.student.full_name}
            </Link>{" "}
            · {rupees(p.amount)} · {fmtDate(p.paid_on)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <PrintButton label="Print receipt" variant="primary" />
          <LinkButton href={copies.length === 2 ? `/payments/${id}` : `/payments/${id}?copies=2`}>{copies.length === 2 ? "Single copy" : "Two copies"}</LinkButton>
          {writer && (
            <LinkButton href={`/collect/${d.student.id}`}>
              <IndianRupee className="size-4" /> Collect again
            </LinkButton>
          )}
          {writer && <LinkButton href="/collect">Next student</LinkButton>}
        </div>
      </div>

      {(p.cancelled || p.is_reversal) && (
        <div className="no-print mb-4 rounded-2xl bg-critical-soft px-4 py-3 text-subhead text-ink">
          {p.cancelled && reversal ? (
            <>
              This receipt was <b>cancelled</b> on {fmtDate(reversal.paid_on)} ({reversal.remarks ?? ""}). Reversal entry{" "}
              <Link className="underline" href={`/payments/${reversal.id}`}>
                {reversal.receipt_no}
              </Link>
              .
            </>
          ) : (
            <>
              This is a <b>cancellation entry</b> for receipt{" "}
              {original ? (
                <Link className="underline" href={`/payments/${original.payment_id}`}>
                  {original.receipt_no}
                </Link>
              ) : (
                "—"
              )}
              . {p.remarks}
            </>
          )}
        </div>
      )}

      <div className={cn("mx-auto max-w-[760px] space-y-6 print:max-w-none", copies.length === 2 && "print:space-y-0")}>
        {copies.map((copy, idx) => (
          <article
            key={idx}
            className={cn(
              "relative overflow-hidden rounded-[28px] bg-surface p-7 shadow-card sm:p-9 print:rounded-none print:p-0 print:shadow-none",
              idx > 0 && "print:mt-6 print:border-t print:border-dashed print:pt-6",
            )}
          >
            {(p.cancelled || p.is_reversal) && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center" aria-hidden>
                <span className="-rotate-12 rounded-lg border-4 border-critical/40 px-6 py-2 text-5xl font-black tracking-widest text-critical/30">
                  {p.is_reversal ? "REVERSAL" : "CANCELLED"}
                </span>
              </div>
            )}
            <header className="flex items-start justify-between gap-4 border-b border-line pb-4">
              <div>
                <div className="text-title3 font-bold text-ink">{settings?.school_name ?? "School"}</div>
                {settings?.address && <div className="text-footnote text-ink-2">{settings.address}</div>}
                <div className="text-footnote text-ink-2">
                  {[settings?.phone, settings?.email].filter(Boolean).join(" · ")}
                </div>
                {settings?.affiliation && <div className="text-caption text-muted">{settings.affiliation}</div>}
              </div>
              <div className="text-right">
                <div className="text-footnote font-semibold uppercase tracking-wider text-ink">{p.is_reversal ? "Cancellation" : "Fee receipt"}</div>
                {copy && <div className="text-caption text-muted">{copy}</div>}
                <div className="mt-1 text-headline font-semibold tabular text-ink">{p.receipt_no}</div>
                <div className="text-footnote text-ink-2">{fmtDate(p.paid_on)}</div>
                <div className="text-caption text-muted">Session {p.session_name}</div>
              </div>
            </header>

            <dl className="grid grid-cols-2 gap-x-6 gap-y-1 border-b border-line py-3 text-footnote sm:grid-cols-4">
              <div className="col-span-2">
                <dt className="text-muted">Student</dt>
                <dd className="font-semibold text-ink">{d.student.full_name}</dd>
              </div>
              <div>
                <dt className="text-muted">Admission no.</dt>
                <dd className="font-medium">{d.student.admission_no}</dd>
              </div>
              <div>
                <dt className="text-muted">Class</dt>
                <dd className="font-medium">{enr ? `${enr.class_name}-${enr.section}${enr.roll_no ? ` / ${enr.roll_no}` : ""}` : "—"}</dd>
              </div>
              <div className="col-span-2">
                <dt className="text-muted">Father / guardian</dt>
                <dd>{d.student.father_name ?? "—"}</dd>
              </div>
              <div className="col-span-2">
                <dt className="text-muted">Phone</dt>
                <dd>{d.student.phone ?? "—"}</dd>
              </div>
            </dl>

            <table className="mt-3 w-full text-footnote">
              <thead>
                <tr className="border-b border-line text-left text-caption uppercase tracking-wide text-muted">
                  <th className="py-1.5 font-medium">Particulars</th>
                  <th className="py-1.5 font-medium">Paid against</th>
                  <th className="py-1.5 text-right font-medium">Amount</th>
                </tr>
              </thead>
              <tbody className="tabular">
                {p.allocations.map((a, i) => (
                  <tr key={i} className="border-b border-line/70">
                    <td className="py-1.5 text-ink">{a.fee_head ?? "Advance (adjusted against future fees)"}</td>
                    <td className="py-1.5 text-ink-2">
                      {a.installment ? (
                        <>
                          {a.session} · {a.installment}
                          {a.kind === "arrears" && <Badge tone="serious" className="ml-1.5 print:border print:border-line">Old dues</Badge>}
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="py-1.5 text-right">{rupees(a.amount)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={2} className="pt-2 text-right font-semibold">
                    Total {p.amount < 0 ? "reversed" : "received"}
                  </td>
                  <td className="pt-3 text-right text-title2 font-bold tabular">{rupees(p.amount)}</td>
                </tr>
              </tfoot>
            </table>
            <p className="mt-1 text-footnote italic text-ink-2">{rupeesInWords(Math.abs(p.amount))}</p>

            <div className="mt-5 grid gap-3 rounded-2xl bg-fill-2 p-4 text-footnote sm:grid-cols-3 print:bg-transparent print:p-0">
              <div>
                <div className="text-muted">Mode</div>
                <div className="font-medium">
                  {MODE_LABELS[p.mode]}
                  {p.reference_no ? ` · ${p.reference_no}` : ""}
                </div>
              </div>
              {!p.is_reversal && (
                <>
                  <div>
                    <div className="text-muted">Outstanding before</div>
                    <div className="font-medium tabular">{rupees(p.outstanding_before)}</div>
                  </div>
                  <div>
                    <div className="text-muted">Balance after this receipt</div>
                    <div className="font-semibold tabular">{rupees(balanceAfter)}</div>
                  </div>
                </>
              )}
            </div>
            {p.remarks && !p.is_reversal && <p className="mt-2 text-footnote text-ink-2">Remarks: {p.remarks}</p>}
            {nowOutstanding !== balanceAfter && !p.is_reversal && (
              <p className="mt-2 text-caption text-muted">Total outstanding as on {fmtDate(d.today)}: {rupees(nowOutstanding)}</p>
            )}

            <footer className="mt-8 flex items-end justify-between gap-4 text-caption text-muted">
              <div>
                <div>{settings?.receipt_footer}</div>
                <div>
                  Entered {fmtDateTime(pay.created_at)}
                  {creatorName ? ` by ${creatorName}` : ""}
                </div>
              </div>
              <div className="text-center">
                <div className="mb-1 h-8 w-40 border-b border-line-strong" />
                Received by
              </div>
            </footer>
          </article>
        ))}
      </div>

      {!p.cancelled && !p.is_reversal && (
        <div className="no-print mx-auto mt-4 flex max-w-[760px] flex-wrap items-center justify-between gap-3">
          <ReceiptSource paymentId={id} studentId={pay.student_id} paidOn={p.paid_on} source={res.data.source} writer={writer} />
          {writer && <CancelReceipt paymentId={id} receiptNo={p.receipt_no} />}
        </div>
      )}
    </>
  );
}
