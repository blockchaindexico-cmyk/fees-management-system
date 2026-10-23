// Form handlers for student activities (API: /api/activities) and for counting a receipt for an activity
// (API: /api/payments/[id]/source). They call the API and refresh the screen.

import { api, errorMessage, refreshAll, submit } from "@/lib/api/client";
import { parseRupees } from "@/lib/format";
import { PARTICIPANT_RESPONSES, type ParticipantResponse } from "@/lib/recovery";
import type { ActionState } from "@/lib/action-state";
import { isIsoDate, isUuid, text } from "../students/helpers";

type Result = { message: string };
const withMessage = (r: Result): ActionState => ({ ok: true, message: r.message });

/** The fields of an activity from a form, checked; or an error. */
function activityFields(formData: FormData): { error: string } | { body: Record<string, unknown> } {
  const name = text(formData, "name");
  const start = text(formData, "start_date");
  const end = text(formData, "end_date");
  const targetRaw = text(formData, "target_amount");
  const target = targetRaw ? parseRupees(targetRaw) : null;
  if (!name) return { error: "Give the activity a name." };
  if (!isIsoDate(start)) return { error: "Enter the start date." };
  if (end && !isIsoDate(end)) return { error: "The end date is not a valid date." };
  if (end && start && end < start) return { error: "The end date cannot be before the start date." };
  if (targetRaw && (target === null || target <= 0)) return { error: "The target is not a valid rupee amount." };
  return {
    body: {
      name,
      description: text(formData, "description"),
      start_date: start,
      end_date: end,
      status: text(formData, "status") === "closed" ? "closed" : "active",
      target_amount: target,
    },
  };
}

/** Create (no id) or update (id) an activity. A new one can start with one student (`student_id`). */
export async function saveActivity(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const id = text(formData, "id");
  const f = activityFields(formData);
  if ("error" in f) return f;
  if (!id) {
    const studentId = text(formData, "student_id");
    if (studentId && !isUuid(studentId)) return { error: "Unknown student." };
    return submit(
      () => api.post<{ id: string; message: string }>("/api/activities", { ...f.body, student_ids: studentId ? [studentId] : [] }),
      (r) => ({ ok: true, message: r.message, data: r.id, redirect: studentId ? undefined : `/activities/${r.id}` }),
    );
  }
  if (!isUuid(id)) return { error: "Unknown activity." };
  return submit(() => api.put<Result>(`/api/activities/${id}`, f.body), (r) => ({ ok: true, message: r.message, redirect: `/activities/${id}` }));
}

export async function deleteActivity(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const id = text(formData, "id");
  if (!isUuid(id)) return { error: "Unknown activity." };
  try {
    await api.delete(`/api/activities/${id}`);
  } catch (e) {
    return { error: errorMessage(e) };
  }
  await refreshAll(id);
  return { ok: true, redirect: "/activities" };
}

/** Add a class (section) to an activity, optionally only the students who owe. */
export async function addClassToActivity(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const id = text(formData, "activity_id");
  const classId = text(formData, "class_id");
  if (!isUuid(id)) return { error: "Unknown activity." };
  if (!isUuid(classId)) return { error: "Choose a class." };
  return submit(
    () =>
      api.post<Result>(`/api/activities/${id}/participants`, {
        class_id: classId,
        section: text(formData, "section"),
        only_with_dues: formData.get("only_with_dues") === "on",
      }),
    withMessage,
  );
}

export async function addStudentToActivity(activityId: string, studentId: string): Promise<ActionState> {
  return submit(() => api.post<Result>(`/api/activities/${activityId}/participants`, { student_ids: [studentId] }), withMessage);
}

/** The family's response to the activity: did fees come in because of it? */
export async function saveResponse(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const activityId = text(formData, "activity_id");
  const id = text(formData, "participant_id");
  const response = text(formData, "response") as ParticipantResponse | null;
  if (!isUuid(activityId) || !isUuid(id)) return { error: "Unknown participant." };
  if (!response || !PARTICIPANT_RESPONSES.includes(response)) return { error: "Choose a response." };
  return submit(() => api.patch<Result>(`/api/activities/${activityId}/participants/${id}`, { response, note: text(formData, "note") }), withMessage);
}

export async function removeParticipant(activityId: string, id: string): Promise<ActionState> {
  return submit(() => api.delete(`/api/activities/${activityId}/participants/${id}`));
}

/** Count a receipt as paid because of the activity (participantId), or for nothing (null). */
export async function countReceipt(paymentId: string, participantId: string | null): Promise<ActionState> {
  return submit(() => api.put<Result>(`/api/payments/${paymentId}/source`, { participant_id: participantId }), withMessage);
}
