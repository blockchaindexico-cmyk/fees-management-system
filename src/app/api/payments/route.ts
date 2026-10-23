import { z } from "zod";
import { ApiError, api, readBody, readQuery } from "@/server/http";
import { collect, register } from "@/server/services/payments";
import { id, isoDate, optionalText, paise } from "@/server/validate";

const Query = z.object({ from: isoDate("Choose the first day."), to: isoDate("Choose the last day.") });

/** Payment register for a date range (inclusive). */
export const GET = api("staff", async ({ req, viewer }) => {
  const { from, to } = readQuery(req, Query);
  if (from > to) throw new ApiError(400, "The first day must not be after the last day.");
  return register(viewer, from, to);
});

const Body = z
  .object({
    student_id: id("Unknown student."),
    amount: paise("Enter the amount received.").positive("Enter the amount received."),
    paid_on: isoDate("Enter the payment date."),
    mode: z.enum(["cash", "upi", "cheque", "bank_transfer", "card", "other"], { error: "Choose a payment mode." }),
    reference_no: optionalText(100),
    remarks: optionalText(500),
    targets: z.array(z.object({ charge_id: id("Invalid allocation lines."), amount: paise().positive() })).max(500).default([]),
    credit_call_id: id("Unknown call.")
      .nullish()
      .transform((v) => v ?? null),
    credit_participant_id: id("Unknown activity.")
      .nullish()
      .transform((v) => v ?? null),
  })
  .refine((b) => b.credit_call_id === null || b.credit_participant_id === null, "Choose a call or an activity, not both.")
  .refine((b) => !["cheque", "upi", "bank_transfer"].includes(b.mode) || b.reference_no, {
    error: (iss) => ((iss.input as { mode?: string }).mode === "cheque" ? "Enter the cheque number." : "Enter the transaction / UTR reference."),
  })
  .refine((b) => b.targets.reduce((a, t) => a + t.amount, 0) <= b.amount, "The amounts allocated to dues add up to more than the amount received.");

/** Collect a fee payment (optionally counted for the call or the activity that brought it in). Returns the receipt's id and number. */
export const POST = api("writer", async ({ req, viewer }) => collect(viewer, await readBody(req, Body)));
