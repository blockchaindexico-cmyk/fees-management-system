// Fee recovery vocabulary shared by the API (validation) and the screens (labels). The keys match the CHECK
// constraints and the call list / activity functions in db/migrations/*_recovery.sql and *_daily_calls.sql.

export const RELATIONS = ["father", "mother", "guardian", "other"] as const;
export const ECONOMIC = ["low", "lower_middle", "middle", "upper_middle", "high"] as const;
export const BEHAVIOURS = [
  "regular", "installment_wise", "year_end", "carries_forward", "willing_struggling", "capable_not_paying", "irregular", "non_payer",
] as const;
export const ATTITUDES = ["cooperative", "neutral", "demanding", "difficult"] as const;
export const PURPOSES = ["fees", "performance", "ptm", "query", "other"] as const;
export const OUTCOMES = ["connected", "no_answer", "busy", "switched_off", "wrong_number"] as const;
export const PICKED_BY = ["father", "mother", "guardian", "student", "other"] as const;
export const RESPONSES = ["will_pay", "needs_time", "financial_issue", "complaint", "already_paid", "refused", "call_later", "other"] as const;
export const PARTICIPANT_RESPONSES = ["pending", "positive", "partial", "negative"] as const;

export type Relation = (typeof RELATIONS)[number];
export type Economic = (typeof ECONOMIC)[number];
export type Behaviour = (typeof BEHAVIOURS)[number];
export type Attitude = (typeof ATTITUDES)[number];
export type CallPurpose = (typeof PURPOSES)[number];
export type CallOutcome = (typeof OUTCOMES)[number];
export type PickedBy = (typeof PICKED_BY)[number];
export type CallResponse = (typeof RESPONSES)[number];
export type ParticipantResponse = (typeof PARTICIPANT_RESPONSES)[number];
export type PromiseStatus = "kept" | "pending" | "partial" | "broken";
export type PromiseTiming = "early" | "on_date" | "grace";
export type CallState = "due" | "called" | "promised" | "paid_recently" | "waiting" | "cleared";
export type CallReason =
  | "broken_promise" | "partial_promise" | "call_back" | "high_dues" | "never_paid" | "silent" | "old_dues" | "overdue" | "not_reached";
export type ActivityVerdict = "good" | "fair" | "poor" | "too_early" | "no_students";

type Tone = "neutral" | "accent" | "good" | "warning" | "serious" | "critical";

export const RELATION_LABELS: Record<Relation, string> = { father: "Father", mother: "Mother", guardian: "Guardian", other: "Other" };

export const ECONOMIC_LABELS: Record<Economic, string> = {
  low: "Struggling",
  lower_middle: "Lower middle",
  middle: "Middle",
  upper_middle: "Upper middle",
  high: "Well-off",
};

export const BEHAVIOUR_LABELS: Record<Behaviour, { label: string; hint: string; tone: Tone }> = {
  regular: { label: "Pays on time", hint: "Pays regularly, around the due dates", tone: "good" },
  installment_wise: { label: "Pays installment-wise", hint: "Pays each installment as it falls due", tone: "good" },
  year_end: { label: "Pays at year end", hint: "Clears most of the fees in January–March", tone: "warning" },
  carries_forward: { label: "Carries dues forward", hint: "Leaves part of the fees for the next year", tone: "serious" },
  willing_struggling: { label: "Wants to pay, struggling", hint: "Willing, but money is tight", tone: "warning" },
  capable_not_paying: { label: "Can pay, doesn't", hint: "Has the means but delays or avoids paying", tone: "critical" },
  irregular: { label: "Irregular", hint: "Pays now and then, usually after reminders", tone: "serious" },
  non_payer: { label: "Doesn't pay in the year", hint: "Pays nothing during the year", tone: "critical" },
};

export const ATTITUDE_LABELS: Record<Attitude, string> = {
  cooperative: "Cooperative",
  neutral: "Neutral",
  demanding: "Demanding",
  difficult: "Difficult — handle with care",
};

export const PURPOSE_LABELS: Record<CallPurpose, { label: string; short: string }> = {
  fees: { label: "Fees / payment", short: "Fees" },
  performance: { label: "Student's studies or report", short: "Studies" },
  ptm: { label: "Parent-teacher meeting", short: "PTM" },
  query: { label: "Parent's question", short: "Query" },
  other: { label: "Something else", short: "Other" },
};

export const OUTCOME_LABELS: Record<CallOutcome, string> = {
  connected: "Picked up",
  no_answer: "No answer",
  busy: "Busy / cut the call",
  switched_off: "Switched off / not reachable",
  wrong_number: "Wrong number",
};

export const PICKED_BY_LABELS: Record<PickedBy, string> = {
  father: "Father",
  mother: "Mother",
  guardian: "Guardian",
  student: "Student",
  other: "Someone else",
};

export const RESPONSE_LABELS: Record<CallResponse, string> = {
  will_pay: "Will pay (gave a date)",
  needs_time: "Needs more time",
  financial_issue: "Money problem",
  complaint: "Complaint about the school",
  already_paid: "Says already paid",
  refused: "Refused to pay",
  call_later: "Call again later",
  other: "Other",
};

export const PROMISE_LABELS: Record<PromiseStatus, { label: string; tone: Tone }> = {
  kept: { label: "Kept", tone: "good" },
  pending: { label: "Waiting", tone: "accent" },
  partial: { label: "Partly kept", tone: "serious" },
  broken: { label: "Broken", tone: "critical" },
};

export const TIMING_LABELS: Record<PromiseTiming, string> = {
  early: "paid before the date",
  on_date: "paid on the date",
  grace: "paid within the grace days",
};

/** Why a family is on today's call list (the first one is the main reason). */
export const REASON_LABELS: Record<CallReason, { label: string; hint: string; tone: Tone }> = {
  broken_promise: { label: "Broke a promise", hint: "Promised a date and paid nothing by it (and the grace days)", tone: "critical" },
  partial_promise: { label: "Paid less than promised", hint: "Paid only part of the promised amount by the date", tone: "serious" },
  call_back: { label: "Asked to call today", hint: "The date they asked to be called on has come", tone: "accent" },
  high_dues: { label: "High dues", hint: "Owes more than the high-dues amount in the call list rules", tone: "serious" },
  never_paid: { label: "Never paid", hint: "No payment on record", tone: "critical" },
  silent: { label: "No payment for 2 months", hint: "Nothing paid for 60 days or more", tone: "warning" },
  old_dues: { label: "Old dues", hint: "Owes fees of earlier years", tone: "serious" },
  overdue: { label: "Fees overdue", hint: "Owes fees that have fallen due", tone: "neutral" },
  not_reached: { label: "Not reached last time", hint: "The last call did not get through", tone: "neutral" },
};

/** Where a family with dues stands today. */
export const CALL_STATES: Record<CallState, { label: string; hint: string }> = {
  due: { label: "To call today", hint: "On today's list" },
  called: { label: "Called today", hint: "A fee call was logged today" },
  promised: { label: "Promised to pay", hint: "Waiting for the date they promised (plus the grace days)" },
  paid_recently: { label: "Paid recently", hint: "Paid something recently, so not called" },
  waiting: { label: "Called recently", hint: "Called a few days ago; back on the list on the date shown" },
  cleared: { label: "No dues now", hint: "Owes less than the amount the call list starts at" },
};

export const VERDICT_LABELS: Record<ActivityVerdict, { label: string; hint: string; tone: Tone }> = {
  good: { label: "Working well", hint: "Half or more of the students who owe paid because of it (or the target is reached)", tone: "good" },
  fair: { label: "Some effect", hint: "A quarter to a half of the students who owe paid because of it", tone: "warning" },
  poor: { label: "Not working", hint: "Fewer than a quarter of the students who owe paid because of it", tone: "critical" },
  too_early: { label: "Too early to say", hint: "Less than a week old and nothing counted for it yet", tone: "neutral" },
  no_students: { label: "No students yet", hint: "Add the students taking part", tone: "neutral" },
};

export const PARTICIPANT_LABELS: Record<ParticipantResponse, { label: string; tone: Tone }> = {
  pending: { label: "Waiting", tone: "neutral" },
  positive: { label: "Fees deposited", tone: "good" },
  partial: { label: "Paid part", tone: "warning" },
  negative: { label: "No / declined", tone: "critical" },
};

/** Digits of a phone number the way the database compares them (no +91 or leading 0), or null. */
export function phoneDigits(input: string | null | undefined): string | null {
  let d = String(input ?? "").replace(/\D/g, "");
  if (d.length === 12 && d.startsWith("91")) d = d.slice(2);
  else if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
  return d.length >= 6 && d.length <= 15 ? d : null;
}

/** 9876543210 -> "98765 43210" (other lengths unchanged). */
export function fmtPhone(phone: string | null | undefined): string {
  if (!phone) return "—";
  return /^\d{10}$/.test(phone) ? `${phone.slice(0, 5)} ${phone.slice(5)}` : phone;
}
