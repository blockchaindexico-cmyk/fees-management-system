// Form handler for starting a fee recovery activity for one student (API: POST /api/activities).

import { api, submit } from "@/lib/api/client";
import { parseRupees } from "@/lib/format";
import type { ActionState } from "@/lib/action-state";
import { isIsoDate, isUuid, text } from "../helpers";

export async function createStudentActivity(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const studentId = text(formData, "student_id");
  const name = text(formData, "name");
  const start = text(formData, "start_date");
  const end = text(formData, "end_date");
  const targetRaw = text(formData, "target_amount");
  const target = targetRaw ? parseRupees(targetRaw) : null;
  if (!isUuid(studentId)) return { error: "Unknown student." };
  if (!name) return { error: "Give the activity a name." };
  if (!isIsoDate(start)) return { error: "Enter the start date." };
  if (end && !isIsoDate(end)) return { error: "The end date is not a valid date." };
  if (end && start && end < start) return { error: "The end date cannot be before the start date." };
  if (targetRaw && (target === null || target <= 0)) return { error: "The target is not a valid rupee amount." };

  return submit(
    () =>
      api.post<{ id: string; message: string }>("/api/activities", {
        name,
        description: text(formData, "description"),
        start_date: start,
        end_date: end,
        target_amount: target,
        student_ids: [studentId],
      }),
    (r) => ({ ok: true, message: r.message }),
  );
}
