"use client";

import Link from "next/link";
import { useActionState, useState, useTransition } from "react";
import { Ban } from "lucide-react";
import { useApi } from "@/lib/api/hooks";
import { addDays } from "@/lib/dates";
import { fmtDate } from "@/lib/format";
import { OUTCOME_LABELS, RESPONSE_LABELS } from "@/lib/recovery";
import { cancelReceipt, setReceiptSource } from "./actions";
import type { ActionState } from "@/lib/action-state";
import type { ReceiptData, StudentRecovery } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { FormError, FormSuccess, Input, Select } from "@/components/ui/form";

export function CancelReceipt({ paymentId, receiptNo }: { paymentId: string; receiptNo: string }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<ActionState, FormData>(cancelReceipt, {});
  if (state.ok) return <FormSuccess message={state.message} />;
  if (!open)
    return (
      <Button type="button" variant="ghost" onClick={() => setOpen(true)} className="text-critical-ink">
        <Ban className="size-4" /> Cancel receipt
      </Button>
    );
  return (
    <form action={action} className="w-full space-y-3 rounded-2xl bg-critical-soft p-4">
      <input type="hidden" name="payment_id" value={paymentId} />
      <p className="text-footnote text-ink">
        Cancelling <b>{receiptNo}</b> adds a reversing entry dated today. The original stays on record and the dues it cleared become unpaid again.
      </p>
      <Input name="reason" placeholder="Reason (cheque bounced, wrong student, duplicate entry…)" required autoFocus />
      <FormError message={state.error} />
      <div className="flex gap-2">
        <Button type="submit" variant="danger" size="sm" disabled={pending}>
          {pending ? "Cancelling…" : "Confirm cancellation"}
        </Button>
        <Button type="button" size="sm" onClick={() => setOpen(false)}>
          Keep receipt
        </Button>
      </div>
    </form>
  );
}

/**
 * What brought the receipt in (a call to the family or an activity of the student), shown to staff and changed by
 * the accountant when it was not ticked at the counter.
 */
export function ReceiptSource({
  paymentId,
  studentId,
  paidOn,
  source,
  writer,
}: {
  paymentId: string;
  studentId: string;
  paidOn: string;
  source: ReceiptData["source"];
  writer: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const rec = useApi<StudentRecovery>(editing ? `/api/students/${studentId}/recovery` : null);
  const [value, setValue] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [state, setState] = useState<ActionState>({});
  const current = source ? (source.call_id ? `call:${source.call_id}` : `activity:${source.participant_id}`) : "";
  const since = addDays(paidOn, -60);
  const options = rec.data
    ? [
        ...rec.data.calls
          .filter((c) => c.call_date <= paidOn && c.call_date >= since)
          .map((c) => ({ value: `call:${c.id}`, label: `Call on ${fmtDate(c.call_date)}${c.author ? ` by ${c.author}` : ""} · ${c.response ? RESPONSE_LABELS[c.response] : OUTCOME_LABELS[c.outcome]}` })),
        ...rec.data.activities.filter((a) => a.start_date <= paidOn).map((a) => ({ value: `activity:${a.participant_id}`, label: `Activity: ${a.name}` })),
      ]
    : [];

  return (
    <div className="flex flex-wrap items-center gap-2 text-subhead">
      <span className="text-ink-2">Brought in by:</span>
      {source ? (
        <Link href={source.href} className="font-medium text-accent">
          {source.label}
        </Link>
      ) : (
        <span className="text-ink">nothing in particular</span>
      )}
      {writer && !editing && (
        <button type="button" onClick={() => setEditing(true)} className="text-footnote font-medium text-accent">
          Change
        </button>
      )}
      {editing && (
        <span className="flex flex-wrap items-center gap-2">
          <Select aria-label="What brought this payment in" value={value ?? current} onChange={(e) => setValue(e.target.value)} className="h-9 w-auto max-w-[340px]">
            <option value="">Nothing in particular</option>
            {options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
          <Button
            size="sm"
            disabled={pending || value === null || value === current}
            onClick={() =>
              start(async () => {
                const r = await setReceiptSource(paymentId, value ?? current);
                setState(r);
                if (r.ok) setEditing(false);
              })
            }
          >
            {pending ? "Saving…" : "Save"}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
            Cancel
          </Button>
        </span>
      )}
      <FormError message={state.error} />
    </div>
  );
}
