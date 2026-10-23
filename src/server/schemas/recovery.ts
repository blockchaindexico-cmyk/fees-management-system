import "server-only";
import { z } from "zod";
import {
  ATTITUDES, BEHAVIOURS, ECONOMIC, OUTCOMES, PARTICIPANT_RESPONSES, PICKED_BY, PURPOSES, RELATIONS, RESPONSES, phoneDigits,
} from "@/lib/recovery";
import { EMAIL_RE, id, isoDate, optionalDate, optionalText, paise, requiredText } from "@/server/validate";

const PHONE = "Enter a phone number with 6 to 15 digits.";

/** A phone number as typed; the database stores its digits (normalize_phone). */
const phone = () =>
  z
    .string({ error: PHONE })
    .trim()
    .max(50, PHONE)
    .refine((v) => phoneDigits(v) !== null, PHONE);

const optionalPhone = () => optionalText(50).refine((v) => v === null || phoneDigits(v) !== null, "The alternate phone number does not look right.");

/** Optional choice from a list; empty becomes null. */
const choice = <T extends readonly [string, ...string[]]>(values: T, message: string) =>
  z
    .union([z.enum(values, { error: message }), z.literal("")])
    .nullish()
    .transform((v) => (v ? v : null) as T[number] | null);

export const ParentFields = z.object({
  name: requiredText("Enter the parent's name.", 200),
  phone: phone(),
  relation: z.enum(RELATIONS, { error: "Choose how they are related to the children." }).default("father"),
  alt_phone: optionalPhone(),
  email: optionalText(254).refine((v) => v === null || EMAIL_RE.test(v), "The email address does not look right."),
  address: optionalText(1000),
  occupation: optionalText(200),
  economic_status: choice(ECONOMIC, "Choose an economic condition from the list."),
  payment_behaviour: choice(BEHAVIOURS, "Choose a payment habit from the list."),
  attitude: choice(ATTITUDES, "Choose how they deal with the school from the list."),
  best_time_to_call: optionalText(200),
  concerns: optionalText(2000),
  priorities: optionalText(2000),
  behaviour_notes: optionalText(4000),
  remarks: optionalText(2000),
});

export const ParentUpdateBody = ParentFields.extend({
  /** when the phone number changes, give the children (who have the old number) the new one too */
  update_children_phone: z.boolean().default(true),
});

export const CallBody = z
  .object({
    purpose: z.enum(PURPOSES, { error: "Choose what the call was about." }).default("fees"),
    call_date: optionalDate("Enter the date of the call."),
    outcome: z.enum(OUTCOMES, { error: "Choose whether the call got through." }),
    picked_by: choice(PICKED_BY, "Choose who picked up."),
    response: choice(RESPONSES, "Choose what they said."),
    summary: optionalText(2000),
    promised_date: optionalDate("The promised date is not a valid date."),
    promised_amount: paise("The promised amount is not a valid rupee amount.")
      .positive("The promised amount is not a valid rupee amount.")
      .nullish()
      .transform((v) => v ?? null),
    follow_up_on: optionalDate("The next call date is not a valid date."),
  })
  .refine((b) => b.promised_amount === null || b.promised_date !== null, "Enter the date they promised to pay by.")
  .refine((b) => b.purpose === "fees" || (b.response === null && b.promised_date === null), "A promise to pay is recorded on fee calls.");

const ActivityBase = z.object({
  name: requiredText("Give it a name.", 200),
  description: optionalText(2000),
  start_date: isoDate("Enter the start date."),
  end_date: optionalDate("The end date is not a valid date."),
  status: z.enum(["active", "closed"]).default("active"),
  target_amount: paise("The target is not a valid rupee amount.")
    .positive("The target is not a valid rupee amount.")
    .nullish()
    .transform((v) => v ?? null),
});

const endAfterStart = (b: { start_date: string; end_date: string | null }) => b.end_date === null || b.end_date >= b.start_date;
const END_BEFORE_START = "The end date cannot be before the start date.";

export const ActivityFields = ActivityBase.refine(endAfterStart, END_BEFORE_START);

export const ActivityCreateBody = ActivityBase.extend({
  /** students taking part from the start (e.g. the student whose profile it was created from) */
  student_ids: z.array(id("Unknown student.")).max(500).default([]),
}).refine(endAfterStart, END_BEFORE_START);

export const ParticipantsBody = z
  .object({
    student_ids: z.array(id("Unknown student.")).max(500).default([]),
    class_id: id("Choose a valid class.")
      .nullish()
      .transform((v) => v ?? null),
    section: optionalText(10),
    only_with_dues: z.boolean().default(false),
  })
  .refine((b) => b.class_id !== null || b.student_ids.length > 0, "Choose a class or at least one student.");

export const ParticipantPatch = z.object({
  response: z.enum(PARTICIPANT_RESPONSES, { error: "Choose a response." }),
  note: optionalText(1000),
});

/** Take families from today's call list: the next `count` (default: the school's batch size), or one family. */
export const TakeCallsBody = z.object({
  count: z.number({ error: "Choose how many families." }).int().min(1, "Take at least one family.").max(100, "Take at most 100 families at a time.").nullish(),
  parent_id: id("Unknown family.").nullish(),
});

/** Give back one family (or, without parent_id, every family of mine not called yet). */
export const ReleaseCallsBody = z.object({ parent_id: id("Unknown family.").nullish() });

/** What brought a receipt in: a call, an activity (participation), or nothing (both null). */
export const PaymentSourceBody = z
  .object({
    call_id: id("Unknown call.")
      .nullish()
      .transform((v) => v ?? null),
    participant_id: id("Unknown activity.")
      .nullish()
      .transform((v) => v ?? null),
  })
  .refine((b) => b.call_id === null || b.participant_id === null, "Choose a call or an activity, not both.");

const whole = (message: string, min: number, max: number) => z.number({ error: message }).int(message).min(min, message).max(max, message);

export const CallRulesBody = z.object({
  min_overdue: paise("Enter the smallest overdue amount to call about.").positive("The smallest overdue amount must be more than ₹0."),
  skip_paid_days: whole("Days after a payment must be between 0 and 180.", 0, 180),
  gap_days: whole("Days between calls must be between 1 and 60.", 1, 60),
  high_due: paise("Enter the high-dues amount.").positive("The high-dues amount must be more than ₹0."),
  batch: whole("Families per batch must be between 1 and 100.", 1, 100),
  grace_days: whole("Grace days must be between 0 and 30.", 0, 30),
});

export const PeriodQuery = z
  .object({ from: isoDate("Choose the first day."), to: isoDate("Choose the last day.") })
  .refine((q) => q.from <= q.to, "The first day must not be after the last day.");
