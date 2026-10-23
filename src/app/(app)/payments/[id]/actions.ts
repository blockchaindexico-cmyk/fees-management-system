// Form handlers for cancelling a receipt (API: POST /api/payments/[id]/cancel) and for what brought it in
// (API: PUT /api/payments/[id]/source).

import { api, submit } from "@/lib/api/client";
import type { ActionState } from "@/lib/action-state";

export async function cancelReceipt(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const paymentId = String(formData.get("payment_id") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  if (!reason) return { error: "Give a reason for cancelling (e.g. cheque bounced, wrong student)." };
  return submit(
    () => api.post<{ message: string }>(`/api/payments/${paymentId}/cancel`, { reason }),
    (r) => ({ ok: true, message: r.message }),
  );
}

/** "call:<id>", "activity:<participant id>" or "" (nothing in particular). */
export async function setReceiptSource(paymentId: string, value: string): Promise<ActionState> {
  const [kind, id] = value.split(":");
  return submit(
    () =>
      api.put<{ message: string }>(`/api/payments/${paymentId}/source`, {
        call_id: kind === "call" ? id : null,
        participant_id: kind === "activity" ? id : null,
      }),
    (r) => ({ ok: true, message: r.message }),
  );
}
