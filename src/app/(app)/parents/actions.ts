// Form handlers for parent profiles and calls (API: /api/parents). They call the API and refresh the screen.

import { api, errorMessage, refreshAll, submit } from "@/lib/api/client";
import { parseRupees } from "@/lib/format";
import { phoneDigits } from "@/lib/recovery";
import type { ActionState } from "@/lib/action-state";
import { isIsoDate, isUuid, text } from "../students/helpers";

type Result = { message: string };
const withMessage = (r: Result): ActionState => ({ ok: true, message: r.message });

function readParent(formData: FormData) {
  return {
    name: text(formData, "name"),
    phone: text(formData, "phone"),
    relation: text(formData, "relation") ?? "father",
    alt_phone: text(formData, "alt_phone"),
    email: text(formData, "email"),
    address: text(formData, "address"),
    occupation: text(formData, "occupation"),
    economic_status: text(formData, "economic_status"),
    payment_behaviour: text(formData, "payment_behaviour"),
    attitude: text(formData, "attitude"),
    best_time_to_call: text(formData, "best_time_to_call"),
    concerns: text(formData, "concerns"),
    priorities: text(formData, "priorities"),
    behaviour_notes: text(formData, "behaviour_notes"),
    remarks: text(formData, "remarks"),
  };
}

/** Create (no id) or update (id) a parent profile. */
export async function saveParent(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const id = text(formData, "id");
  const p = readParent(formData);
  if (!p.name) return { error: "Enter the parent's name." };
  if (!phoneDigits(p.phone)) return { error: "Enter a phone number with 6 to 15 digits." };
  if (p.alt_phone && !phoneDigits(p.alt_phone)) return { error: "The alternate phone number does not look right." };
  if (p.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.email)) return { error: "The email address does not look right." };

  if (!id) {
    return submit(() => api.post<{ id: string }>("/api/parents", p), (r) => ({ ok: true, redirect: `/parents/${r.id}` }));
  }
  if (!isUuid(id)) return { error: "Unknown parent." };
  return submit(() => api.put<Result>(`/api/parents/${id}`, { ...p, update_children_phone: formData.get("update_children_phone") === "on" }), withMessage);
}

export async function addChild(parentId: string, studentId: string): Promise<ActionState> {
  return submit(() => api.post<Result>(`/api/parents/${parentId}/children`, { student_id: studentId }), withMessage);
}

export async function mergeParent(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const id = text(formData, "id");
  const phone = text(formData, "phone");
  if (!isUuid(id)) return { error: "Unknown parent." };
  if (!phoneDigits(phone)) return { error: "Enter the phone number of the profile to merge into." };
  try {
    const r = await api.post<Result & { id: string }>(`/api/parents/${id}/merge`, { phone });
    await refreshAll(id); // this profile is gone; do not refetch it
    return { ok: true, message: r.message, redirect: `/parents/${r.id}` };
  } catch (e) {
    return { error: errorMessage(e) };
  }
}

export async function deleteParent(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const id = text(formData, "id");
  if (!isUuid(id)) return { error: "Unknown parent." };
  try {
    await api.delete(`/api/parents/${id}`);
  } catch (e) {
    return { error: errorMessage(e) };
  }
  await refreshAll(id);
  return { ok: true, redirect: "/parents" };
}

export async function linkByPhone(): Promise<ActionState> {
  return submit(() => api.post<Result>("/api/parents/link"), withMessage);
}

/**
 * Log a call about anything. What they said about fees and a promise apply to fee calls that got through. The
 * "next" button (name=go, value=next) opens `next_href` afterwards (the next family on the caller's list).
 */
export async function logCall(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parentId = text(formData, "parent_id");
  const outcome = text(formData, "outcome");
  const purpose = text(formData, "purpose") ?? "fees";
  const connected = outcome === "connected";
  const feeTalk = connected && purpose === "fees";
  const callDate = text(formData, "call_date");
  const promisedDate = feeTalk ? text(formData, "promised_date") : null;
  const amountRaw = feeTalk ? text(formData, "promised_amount") : null;
  const promisedAmount = amountRaw ? parseRupees(amountRaw) : null;
  const followUp = text(formData, "follow_up_on");

  if (!isUuid(parentId)) return { error: "Unknown parent." };
  if (!outcome) return { error: "Choose whether the call got through." };
  if (callDate && !isIsoDate(callDate)) return { error: "Enter the date of the call." };
  if (promisedDate && !isIsoDate(promisedDate)) return { error: "The promised date is not a valid date." };
  if (amountRaw && (promisedAmount === null || promisedAmount <= 0)) return { error: "The promised amount is not a valid rupee amount." };
  if (promisedAmount && !promisedDate) return { error: "Enter the date they promised to pay by." };
  if (followUp && !isIsoDate(followUp)) return { error: "The next call date is not a valid date." };

  const next = formData.get("go") === "next" ? text(formData, "next_href") : null;
  return submit(
    () =>
      api.post<Result>(`/api/parents/${parentId}/calls`, {
        purpose,
        call_date: callDate,
        outcome,
        picked_by: connected ? text(formData, "picked_by") : null,
        response: feeTalk ? text(formData, "response") : null,
        summary: text(formData, "summary"),
        promised_date: promisedDate,
        promised_amount: promisedAmount,
        follow_up_on: followUp,
      }),
    (r) => ({ ok: true, message: r.message, redirect: next ?? undefined }),
  );
}

export async function deleteCall(parentId: string, callId: string): Promise<ActionState> {
  return submit(() => api.delete(`/api/parents/${parentId}/calls/${callId}`));
}
