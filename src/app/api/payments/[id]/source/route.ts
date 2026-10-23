import { api, pathParam, readBody } from "@/server/http";
import { PaymentSourceBody } from "@/server/schemas/recovery";
import { setPaymentSource } from "@/server/services/recovery";
import { id } from "@/server/validate";

/** What brought the receipt in: a call to the family, an activity of the student, or nothing (both null). */
export const PUT = api<{ id: string }>("writer", async ({ req, params, viewer }) => {
  const b = await readBody(req, PaymentSourceBody);
  return setPaymentSource(viewer, pathParam(id(), params.id), b.call_id, b.participant_id);
});
