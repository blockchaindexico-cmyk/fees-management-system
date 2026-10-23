// Form handler for collecting a payment (API: POST /api/payments). Opens the new receipt on success.

import { api, submit } from "@/lib/api/client";
import { parseRupees } from "@/lib/format";
import type { ActionState } from "@/lib/action-state";
import type { PaymentMode } from "@/lib/types";

const MODES: PaymentMode[] = ["cash", "upi", "cheque", "bank_transfer", "card", "other"];

export async function collectPayment(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const studentId = String(formData.get("student_id") ?? "");
  const amount = parseRupees(String(formData.get("amount") ?? ""));
  const paidOn = String(formData.get("paid_on") ?? "");
  const mode = String(formData.get("mode") ?? "cash") as PaymentMode;
  const reference = String(formData.get("reference_no") ?? "").trim();
  const remarks = String(formData.get("remarks") ?? "").trim();
  // what brought the payment in: "call:<id>", "activity:<participant id>" or nothing
  const [kind, sourceId] = String(formData.get("source") ?? "").split(":");
  let targets: { charge_id: string; amount: number }[] = [];
  try {
    targets = JSON.parse(String(formData.get("targets") ?? "[]"));
  } catch {
    return { error: "Could not read the allocation. Please try again." };
  }

  if (!amount || amount <= 0) return { error: "Enter the amount received." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(paidOn)) return { error: "Enter the payment date." };
  if (!MODES.includes(mode)) return { error: "Choose a payment mode." };
  if ((mode === "cheque" || mode === "upi" || mode === "bank_transfer") && !reference) {
    return { error: mode === "cheque" ? "Enter the cheque number." : "Enter the transaction / UTR reference." };
  }
  targets = targets.filter((t) => t && typeof t.charge_id === "string" && Number.isInteger(t.amount) && t.amount > 0);
  const allocated = targets.reduce((a, t) => a + t.amount, 0);
  if (allocated > amount) return { error: "The amounts allocated to dues add up to more than the amount received." };

  return submit(
    () =>
      api.post<{ payment_id: string; receipt_no: string }>("/api/payments", {
        student_id: studentId,
        amount,
        paid_on: paidOn,
        mode,
        reference_no: reference || null,
        remarks: remarks || null,
        targets,
        credit_call_id: kind === "call" ? sourceId : null,
        credit_participant_id: kind === "activity" ? sourceId : null,
      }),
    (r) => ({ ok: true, redirect: `/payments/${r.payment_id}?new=1` }),
  );
}
