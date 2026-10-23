import "server-only";
import type { Viewer } from "@/server/auth/session";
import { read, write } from "@/server/data";
import { notFound } from "@/server/http";
import { orNotFound } from "@/server/services/analytics";
import type { PaymentMode, PaymentRegisterRow, ReceiptData, Student360 } from "@/lib/types";

/** Receipts dated between two days (inclusive), newest first, with class and what each paid for. */
export function register(viewer: Viewer, from: string, to: string) {
  return read(viewer, "payments", [from, to], (db) =>
    db.query<PaymentRegisterRow>(
      `select p.id as payment_id, p.receipt_no, p.paid_on, p.amount, p.mode, p.reference_no, p.remarks, p.source,
              p.session_id, p.student_id, p.reverses_payment_id, p.created_at,
              s.full_name, s.admission_no, s.father_name,
              c.name as class_name, e.section,
              coalesce(a.current, 0) as current, coalesce(a.arrears, 0) as arrears, coalesce(a.advance, 0) as advance,
              exists (select 1 from public.payments r where r.reverses_payment_id = p.id) as cancelled
         from public.payments p
         join public.students s on s.id = p.student_id
         left join public.enrollments e on e.student_id = p.student_id and e.session_id = p.session_id
         left join public.classes c on c.id = e.class_id
         left join lateral (
           select sum(amount) filter (where kind = 'current') as current,
                  sum(amount) filter (where kind = 'arrears') as arrears,
                  sum(amount) filter (where kind = 'advance') as advance
             from public.allocations where payment_id = p.id
         ) a on true
        where p.paid_on between $1 and $2
        order by p.paid_on desc, p.created_at desc, p.id`,
      [from, to],
    ),
  );
}

/** One receipt: the payment's student 360 (allocations, balances), who recorded it and its cancellation. */
export async function receipt(viewer: Viewer, id: string) {
  const data = await read(viewer, "receipt", [id], async (db): Promise<ReceiptData | null> => {
    const pay = await db.one<ReceiptData["payment"]>(
      `select p.id, p.student_id, p.receipt_no, p.created_at, p.reverses_payment_id,
              coalesce(nullif(pr.full_name, ''), pr.email) as created_by_name
         from public.payments p left join public.profiles pr on pr.id = p.created_by
        where p.id = $1`,
      [id],
    );
    if (!pay) return null;
    const [student, reversal, source] = await Promise.all([
      db.rpc<Student360>("student_360", { p_student: pay.student_id }),
      db.one<ReceiptData["reversal"]>("select id, receipt_no, paid_on, remarks from public.payments where reverses_payment_id = $1", [id]),
      db.one<NonNullable<ReceiptData["source"]>>(
        `select rc.call_id, rc.participant_id,
                case when rc.call_id is not null
                     then 'Call on ' || to_char(c.call_date, 'FMDD Mon YYYY') || coalesce(' by ' || coalesce(nullif(pf.full_name, ''), pf.email), '')
                     else 'Activity: ' || a.name end as label,
                case when rc.call_id is not null then '/parents/' || c.parent_id else '/activities/' || a.id end as href
           from public.recovery_credits rc
           left join public.parent_calls c on c.id = rc.call_id
           left join public.profiles pf on pf.id = c.created_by
           left join public.recovery_participants rp on rp.id = rc.participant_id
           left join public.recovery_activities a on a.id = rp.activity_id
          where rc.payment_id = $1`,
        [id],
      ),
    ]);
    return { payment: pay, student, reversal, source };
  });
  if (!data) throw notFound("That receipt does not exist.");
  return data;
}

export type CollectInput = {
  student_id: string;
  amount: number;
  paid_on: string;
  mode: PaymentMode;
  reference_no: string | null;
  remarks: string | null;
  /** what the payment should pay for, chosen at the counter (paise per charge) */
  targets: { charge_id: string; amount: number }[];
  /** what brought the payment in: a call to the family or an activity of the student (a participation), if any */
  credit_call_id: string | null;
  credit_participant_id: string | null;
};

/** Record a payment (collect_payment allocates it and numbers the receipt), counted for a call or an activity when chosen. */
export function collect(viewer: Viewer, input: CollectInput) {
  return orNotFound(
    write(viewer, async (db) => {
      const r = await db.rpc<{ payment_id: string; receipt_no: string }>("collect_payment", {
        p_student: input.student_id,
        p_amount: input.amount,
        p_paid_on: input.paid_on,
        p_mode: input.mode,
        p_reference: input.reference_no,
        p_remarks: input.remarks,
        p_targets: input.targets,
      });
      if (input.credit_call_id || input.credit_participant_id) {
        await db.rpc("set_payment_source", { p_payment: r.payment_id, p_call: input.credit_call_id, p_participant: input.credit_participant_id });
      }
      return r;
    }),
    /^(Student|Call|Participant) not found/,
    "That student, call or activity does not exist.",
  );
}

/** Cancel a receipt: adds a reversing entry dated today; the original stays on record. */
export async function cancel(viewer: Viewer, id: string, reason: string) {
  await orNotFound(
    write(viewer, (db) => db.rpc("cancel_payment", { p_payment: id, p_reason: reason })),
    /^Payment not found/,
    "That receipt does not exist.",
  );
}
