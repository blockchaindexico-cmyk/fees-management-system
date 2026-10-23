import "server-only";
import type { z } from "zod";
import type { Viewer } from "@/server/auth/session";
import { audit, read, write } from "@/server/data";
import type { Db } from "@/server/db";
import { badRequest, notFound } from "@/server/http";
import type { ActivityFields, CallRulesBody, ParticipantPatch, ParticipantsBody } from "@/server/schemas/recovery";
import { orNotFound } from "@/server/services/analytics";
import type { ActivitiesOverview, ActivityDetail, CallBoard, RecoveryActivity, RecoveryDashboard, StudentRecovery } from "@/lib/types";

// Fee recovery: the dashboard, the daily call list (and the families each caller takes from it), student
// activities, and what brought a receipt in (a call or an activity). Figures come from the SQL functions in
// db/migrations/*_recovery.sql and *_daily_calls.sql.

export type ActivityInput = z.output<typeof ActivityFields>;

// ---------------------------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------------------------

/** Money received from `from` to `to`, what brought it in, the calls made and the activities. */
export function dashboard(viewer: Viewer, from: string, to: string) {
  return read(viewer, "recovery-dashboard", [from, to], (db) => db.rpc<RecoveryDashboard>("recovery_dashboard", { p_from: from, p_to: to }));
}

/** Today's call list, today's calls and the viewer's own figures (so cached per user). */
export function callBoard(viewer: Viewer) {
  return read(viewer, "call-board", [viewer.id], (db) => db.rpc<CallBoard>("call_board"));
}

export function activities(viewer: Viewer) {
  return read(viewer, "activities", [], (db) => db.rpc<ActivitiesOverview>("activities_overview"));
}

/** Running activities without their figures (pickers). */
export function runningActivities(viewer: Viewer) {
  return read(viewer, "activities-running", [], (db) =>
    db.query<RecoveryActivity>("select * from public.recovery_activities where status = 'active' order by start_date desc, created_at desc"),
  );
}

export function activity(viewer: Viewer, id: string) {
  return orNotFound(
    read(viewer, "activity", [id], (db) => db.rpc<ActivityDetail>("activity_detail", { p_activity: id })),
    /^Activity not found/,
    "That activity does not exist.",
  );
}

/** A student's family, its latest calls and the activities the student is part of. */
export function studentRecovery(viewer: Viewer, studentId: string) {
  return orNotFound(
    read(viewer, "student-recovery", [studentId], (db) => db.rpc<StudentRecovery>("student_recovery", { p_student: studentId })),
    /^Student not found/,
    "That student does not exist.",
  );
}

// ---------------------------------------------------------------------------------------------
// The daily call list
// ---------------------------------------------------------------------------------------------

/** Take the next `count` families of today's list (default: the school's batch size), or one family. */
export async function takeCalls(viewer: Viewer, count: number | null, parentId: string | null) {
  if (parentId) {
    await orNotFound(
      write(viewer, (db) => db.rpc("take_call", { p_parent: parentId })),
      /^Parent not found/,
      "That family does not exist.",
    );
    return { message: "Added to your list for today." };
  }
  const n = await write(viewer, (db) => db.rpc<number>("take_calls", { p_count: count ?? undefined }));
  return {
    message:
      n === 0
        ? "Nobody is left to take: every family on today's list is with a caller."
        : `${n} ${n === 1 ? "family" : "families"} added to your list, highest priority first.`,
  };
}

/** Give one family back to today's list, or every family of mine not called yet. */
export async function releaseCalls(viewer: Viewer, parentId: string | null) {
  const n = await write(viewer, (db) => db.rpc<number>("release_calls", { p_parent: parentId ?? undefined }));
  if (parentId) return { message: n === 0 ? "That family is not on your list." : "Given back to today's list." };
  return { message: n === 0 ? "Every family on your list has been called." : `${n} ${n === 1 ? "family" : "families"} given back to today's list.` };
}

/** The rules that build the call list (and the promise grace days). */
export async function updateCallRules(viewer: Viewer, r: z.output<typeof CallRulesBody>) {
  return write(viewer, async (db) => {
    await db.query(
      `update public.school_settings
          set call_min_overdue = $1, call_skip_paid_days = $2, call_gap_days = $3, call_high_due = $4, call_batch = $5,
              promise_grace_days = $6
        where id = 1`,
      [r.min_overdue, r.skip_paid_days, r.gap_days, r.high_due, r.batch, r.grace_days],
    );
    await audit(db, "change_call_rules", "school_settings", "1", r);
    return { message: "Saved. Today's call list follows the new rules." };
  });
}

// ---------------------------------------------------------------------------------------------
// Activities
// ---------------------------------------------------------------------------------------------

const FIELDS = ["name", "description", "start_date", "end_date", "status", "target_amount"] as const;

/**
 * add_activity_participants() takes the students as uuid[]; db.rpc() sends JS arrays as jsonb, so this calls it
 * with an explicit cast (pg sends a JS array as a Postgres array).
 */
async function addToActivity(
  db: Db,
  activityId: string,
  o: { studentIds: string[]; classId?: string | null; section?: string | null; onlyDues?: boolean },
) {
  const row = await db.one<{ n: number }>(
    `select public.add_activity_participants(p_activity => $1, p_students => $2::uuid[], p_class => $3, p_section => $4,
                                             p_only_dues => $5) as n`,
    [activityId, o.studentIds.length ? o.studentIds : null, o.classId ?? null, o.section ?? null, o.onlyDues ?? false],
  );
  return Number(row?.n ?? 0);
}

/** Create an activity, optionally with `studentIds` taking part from the start (all in one transaction). */
export async function createActivity(viewer: Viewer, a: ActivityInput, studentIds: string[] = []) {
  return write(viewer, async (db) => {
    const row = await db.one<{ id: string }>(
      `insert into public.recovery_activities (${FIELDS.join(", ")}) values (${FIELDS.map((_, i) => `$${i + 1}`).join(", ")}) returning id`,
      FIELDS.map((f) => a[f]),
    );
    const added = studentIds.length ? await addToActivity(db, row!.id, { studentIds }) : 0;
    if (added < studentIds.length) throw notFound("That student does not exist.");
    await audit(db, "create_activity", "recovery_activities", row!.id, { name: a.name, students: added });
    return { id: row!.id, message: `“${a.name}” created.` };
  });
}

export async function updateActivity(viewer: Viewer, id: string, a: ActivityInput) {
  return write(viewer, async (db) => {
    const row = await db.one<{ id: string }>(
      `update public.recovery_activities set ${FIELDS.map((f, i) => `${f} = $${i + 2}`).join(", ")} where id = $1 returning id`,
      [id, ...FIELDS.map((f) => a[f])],
    );
    if (!row) throw notFound("This activity no longer exists.");
    await audit(db, "update_activity", "recovery_activities", id, { name: a.name, status: a.status });
    return { message: a.status === "closed" ? "Saved. The activity is closed." : "Saved." };
  });
}

/** Delete an activity no receipt is counted for (otherwise close it, so its results stay). */
export async function deleteActivity(viewer: Viewer, id: string) {
  await write(viewer, async (db) => {
    const a = await db.one<{ name: string }>("select name from public.recovery_activities where id = $1", [id]);
    if (!a) throw notFound("This activity no longer exists.");
    const credits = await db.count(
      "select 1 from public.recovery_credits rc join public.recovery_participants rp on rp.id = rc.participant_id where rp.activity_id = $1",
      [id],
    );
    if (credits > 0) throw badRequest("Receipts are already counted for this activity. Close it instead, so its results are kept.");
    await db.query("delete from public.recovery_activities where id = $1", [id]);
    await audit(db, "delete_activity", "recovery_activities", id, a);
  });
}

export async function addParticipants(viewer: Viewer, activityId: string, p: z.output<typeof ParticipantsBody>) {
  const n = await orNotFound(
    write(viewer, (db) => addToActivity(db, activityId, { studentIds: p.student_ids, classId: p.class_id, section: p.section, onlyDues: p.only_with_dues })),
    /^Activity not found/,
    "That activity does not exist.",
  );
  return {
    message: n === 0 ? "No new students: they are already in the activity (or none matched)." : `${n} ${n === 1 ? "student" : "students"} added.`,
  };
}

export async function updateParticipant(viewer: Viewer, activityId: string, id: string, p: z.output<typeof ParticipantPatch>) {
  await write(viewer, async (db) => {
    const row = await db.one(
      `update public.recovery_participants
          set response = $3, note = $4, updated_by = public.current_user_id(), updated_at = now()
        where id = $1 and activity_id = $2 returning id`,
      [id, activityId, p.response, p.note],
    );
    if (!row) throw notFound("This student is no longer in the activity.");
  });
  return { message: "Saved." };
}

export async function removeParticipant(viewer: Viewer, activityId: string, id: string) {
  await write(viewer, async (db) => {
    const row = await db.one<{ student_id: string }>(
      "delete from public.recovery_participants where id = $1 and activity_id = $2 returning student_id",
      [id, activityId],
    );
    if (!row) throw notFound("This student is no longer in the activity.");
    await audit(db, "remove_participant", "recovery_participants", id, { activity: activityId, ...row });
  });
}

// ---------------------------------------------------------------------------------------------
// What brought a receipt in
// ---------------------------------------------------------------------------------------------

/** Count a receipt for the call or the activity that brought it in (or for nothing: both null). */
export async function setPaymentSource(viewer: Viewer, paymentId: string, callId: string | null, participantId: string | null) {
  await orNotFound(
    write(viewer, (db) => db.rpc("set_payment_source", { p_payment: paymentId, p_call: callId, p_participant: participantId })),
    /^(Payment|Call|Participant) not found/,
    "That receipt, call or activity does not exist.",
  );
  return {
    message: callId ? "Receipt counted for the call." : participantId ? "Receipt counted for the activity." : "Receipt not counted for a call or an activity.",
  };
}
