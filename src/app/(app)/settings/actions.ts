// Form handlers for school settings (API: /api/settings). Admin only.

import { api, submit } from "@/lib/api/client";
import { parseRupees } from "@/lib/format";
import type { ActionState } from "@/lib/action-state";

type Result = { message: string };
const withMessage = (r: Result): ActionState => ({ ok: true, message: r.message });

function text(formData: FormData, key: string): string | null {
  const v = formData.get(key);
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : t;
}

export async function updateSchoolProfile(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const schoolName = text(formData, "school_name");
  const receiptPrefix = text(formData, "receipt_prefix");
  const email = text(formData, "email");
  const month = Number(text(formData, "session_start_month"));
  if (!schoolName) return { error: "Enter the school name." };
  if (!receiptPrefix) return { error: "Enter a receipt prefix (for example R or SPS)." };
  if (!/^[A-Za-z0-9/_.-]{1,12}$/.test(receiptPrefix)) {
    return { error: "Receipt prefix: up to 12 letters or digits (/, -, _ and . are allowed), no spaces." };
  }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: "The email address does not look right." };
  if (!Number.isInteger(month) || month < 1 || month > 12) return { error: "Choose the month a session starts." };

  return submit(
    () =>
      api.put<Result>("/api/settings", {
        school_name: schoolName,
        address: text(formData, "address"),
        phone: text(formData, "phone"),
        email,
        affiliation: text(formData, "affiliation"),
        receipt_prefix: receiptPrefix,
        receipt_footer: text(formData, "receipt_footer"),
        session_start_month: month,
      }),
    withMessage,
  );
}

export async function updateAllocationRule(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const rule = text(formData, "allocation_order");
  if (rule !== "oldest_first" && rule !== "current_first") return { error: "Choose an allocation rule." };
  return submit(() => api.put<Result>("/api/settings/allocation-rule", { allocation_order: rule }), withMessage);
}

/** The rules that build the daily call list, and the promise grace days. */
export async function updateCallRules(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const whole = (key: string) => Number(text(formData, key));
  const minOverdue = parseRupees(text(formData, "min_overdue"));
  const highDue = parseRupees(text(formData, "high_due"));
  const skip = whole("skip_paid_days");
  const gap = whole("gap_days");
  const grace = whole("grace_days");
  const batch = whole("batch");
  if (minOverdue === null || minOverdue <= 0) return { error: "Enter the smallest overdue amount to call about." };
  if (highDue === null || highDue <= 0) return { error: "Enter the amount that counts as high dues." };
  if (!Number.isInteger(skip) || skip < 0 || skip > 180) return { error: "Days after a payment must be between 0 and 180." };
  if (!Number.isInteger(gap) || gap < 1 || gap > 60) return { error: "Days between calls must be between 1 and 60." };
  if (!Number.isInteger(grace) || grace < 0 || grace > 30) return { error: "Grace days must be between 0 and 30." };
  if (!Number.isInteger(batch) || batch < 1 || batch > 100) return { error: "Families per batch must be between 1 and 100." };
  return submit(
    () =>
      api.put<Result>("/api/settings/call-rules", {
        min_overdue: minOverdue,
        high_due: highDue,
        skip_paid_days: skip,
        gap_days: gap,
        grace_days: grace,
        batch,
      }),
    withMessage,
  );
}
