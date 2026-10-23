/** Shape returned by every form handler (see `submit` in src/lib/api/client.ts), consumed with useActionState. */
export type ActionState = {
  ok?: boolean;
  error?: string;
  message?: string;
  /** Free-form result payload (e.g. import summaries) */
  data?: unknown;
  /** Page to open after success (useFormAction navigates there) */
  redirect?: string;
};

/** Turn a Postgres error into a sentence a school accountant can act on (used by the API). */
export function friendlyError(error: { message?: string; code?: string; details?: string } | null | undefined): string {
  if (!error) return "Something went wrong.";
  const msg = error.message ?? "";
  if (error.code === "42501") return "You do not have permission to do this.";
  if (error.code === "23505") {
    if (msg.includes("admission_no")) return "A student with this admission number already exists.";
    if (msg.includes("academic_sessions_name")) return "A session with this name already exists.";
    if (msg.includes("classes_name")) return "A class with this name already exists.";
    if (msg.includes("fee_heads_name")) return "A fee head with this name already exists.";
    if (msg.includes("installments_session_id_number")) return "That installment number already exists in this session.";
    if (msg.includes("parents_phone_key")) return "Another parent profile already has this phone number.";
    return "This record already exists.";
  }
  if (error.code === "23P01" || msg.includes("academic_sessions_no_overlap")) return "Session dates overlap with another session.";
  if (error.code === "23503") return "This record is still in use and cannot be removed.";
  if (error.code === "23514") return "One of the values is not allowed. Check amounts and dates.";
  return msg || "Something went wrong.";
}
