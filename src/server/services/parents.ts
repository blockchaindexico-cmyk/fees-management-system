import "server-only";
import type { z } from "zod";
import type { Viewer } from "@/server/auth/session";
import { audit, read, write } from "@/server/data";
import { isDbError, type Db } from "@/server/db";
import { ApiError, badRequest, notFound } from "@/server/http";
import type { CallBody, ParentFields } from "@/server/schemas/recovery";
import { orNotFound } from "@/server/services/analytics";
import { fmtDate, rupees } from "@/lib/format";
import type { Parent, Parent360, ParentBalance } from "@/lib/types";

// Parent (family) profiles. A family is keyed by its phone number: students are linked to it by the
// students_link_parent trigger, so brothers and sisters share one profile. Every figure comes from the
// parent_* SQL functions in db/migrations/*_recovery.sql.

export type ParentInput = z.output<typeof ParentFields>;
export type CallInput = z.output<typeof CallBody>;

// ---------------------------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------------------------

/** Every family with its children's balances in `sessionId` added up. */
export function list(viewer: Viewer, sessionId: string) {
  return read(viewer, "parents", [sessionId], (db) =>
    db.rpcRows<ParentBalance>("parent_balances", { p_session: sessionId }, () => "order by total_overdue desc, name, phone"),
  );
}

/** Parent 360 for a session (default: the running one). */
export function get360(viewer: Viewer, id: string, sessionId: string | null) {
  return orNotFound(
    read(viewer, "parent-360", [id, sessionId], (db) => db.rpc<Parent360>("parent_360", { p_parent: id, p_session: sessionId ?? undefined })),
    /not found/i,
    "That parent does not exist.",
  );
}

// ---------------------------------------------------------------------------------------------
// Profiles
// ---------------------------------------------------------------------------------------------

const FIELDS = [
  "name", "relation", "email", "address", "occupation", "economic_status", "payment_behaviour", "attitude", "best_time_to_call",
  "concerns", "priorities", "behaviour_notes", "remarks",
] as const;

/** The profile already using a phone number (as its main or alternate number). */
async function byPhone(db: Db, phone: string) {
  return db.one<{ id: string; name: string }>(
    `select id, name from public.parents
      where phone = public.normalize_phone($1) or alt_phone = public.normalize_phone($1)
      order by (phone = public.normalize_phone($1)) desc limit 1`,
    [phone],
  );
}

function duplicate(existing: { id: string; name: string }) {
  return new ApiError(409, `${existing.name} already has this phone number. Open that profile instead.`, "duplicate", { parent_id: existing.id });
}

export async function create(viewer: Viewer, p: ParentInput) {
  return write(viewer, async (db) => {
    const existing = await byPhone(db, p.phone);
    if (existing) throw duplicate(existing);
    const row = await db.one<{ id: string }>(
      `insert into public.parents (phone, alt_phone, ${FIELDS.join(", ")})
       values (public.normalize_phone($1), public.normalize_phone($2), ${FIELDS.map((_, i) => `$${i + 3}`).join(", ")})
       returning id`,
      [p.phone, p.alt_phone, ...FIELDS.map((f) => p[f])],
    );
    // students who already have this number join the new family
    const linked = await db.query<{ id: string }>(
      "update public.students set parent_id = $1 where parent_id is null and public.normalize_phone(phone) = public.normalize_phone($2) returning id",
      [row!.id, p.phone],
    );
    await audit(db, "create_parent", "parents", row!.id, { name: p.name, phone: p.phone });
    return { id: row!.id, linked: linked.length };
  });
}

/**
 * Save a profile. When the phone number changes and `updateChildrenPhone` is set, the children who had the old
 * number get the new one as well (so the family stays together and reminders reach the right phone).
 */
export async function update(viewer: Viewer, id: string, p: ParentInput, updateChildrenPhone: boolean) {
  return write(viewer, async (db) => {
    const before = await db.one<Parent>("select * from public.parents where id = $1 for update", [id]);
    if (!before) throw notFound("This parent no longer exists.");
    const existing = await byPhone(db, p.phone);
    if (existing && existing.id !== id) throw duplicate(existing);
    try {
      await db.query(
        `update public.parents
            set phone = public.normalize_phone($2), alt_phone = public.normalize_phone($3),
                ${FIELDS.map((f, i) => `${f} = $${i + 4}`).join(", ")}
          where id = $1`,
        [id, p.phone, p.alt_phone, ...FIELDS.map((f) => p[f])],
      );
    } catch (e) {
      if (isDbError(e) && e.code === "23505") throw new ApiError(409, "Another parent profile already has this phone number.");
      throw e;
    }
    const after = await db.one<{ phone: string }>("select phone from public.parents where id = $1", [id]);
    let moved = 0;
    if (after && after.phone !== before.phone && updateChildrenPhone) {
      const rows = await db.query(
        "update public.students set phone = $2 where parent_id = $1 and public.normalize_phone(phone) = $3 returning id",
        [id, p.phone, before.phone],
      );
      moved = rows.length;
    }
    await audit(db, "update_parent", "parents", id, { name: p.name, phone_from: before.phone, phone: after?.phone });
    return {
      message: moved > 0 ? `Saved. The new number was also set on ${moved} ${moved === 1 ? "child" : "children"}.` : "Saved.",
    };
  });
}

/** Delete a profile that has no children and no call history (otherwise merge it into the right one). */
export async function remove(viewer: Viewer, id: string) {
  await write(viewer, async (db) => {
    const p = await db.one<{ name: string; phone: string }>("select name, phone from public.parents where id = $1", [id]);
    if (!p) throw notFound("This parent no longer exists.");
    if ((await db.count("select 1 from public.students where parent_id = $1", [id])) > 0) {
      throw badRequest("This profile still has children. Move them to another parent, or merge this profile into the right one.");
    }
    if ((await db.count("select 1 from public.parent_calls where parent_id = $1", [id])) > 0) {
      throw badRequest("This profile has call history. Merge it into the right profile instead, so the calls are kept.");
    }
    await db.query("delete from public.parents where id = $1", [id]);
    await audit(db, "delete_parent", "parents", id, p);
  });
}

/** Move a student into this family (their own phone number is left as it is). */
export async function addChild(viewer: Viewer, parentId: string, studentId: string) {
  return write(viewer, async (db) => {
    const parent = await db.one<{ name: string }>("select name from public.parents where id = $1", [parentId]);
    if (!parent) throw notFound("This parent no longer exists.");
    const st = await db.one<{ full_name: string; parent_id: string | null }>("select full_name, parent_id from public.students where id = $1", [studentId]);
    if (!st) throw notFound("That student does not exist.");
    if (st.parent_id === parentId) return { message: `${st.full_name} is already in this family.` };
    await db.query("update public.students set parent_id = $1 where id = $2", [parentId, studentId]);
    await audit(db, "move_child", "students", studentId, { from: st.parent_id, to: parentId });
    return { message: `${st.full_name} added to ${parent.name}'s family.` };
  });
}

/** Merge this profile into the one with `intoPhone`: children and calls move, this number becomes its alternate. */
export async function merge(viewer: Viewer, fromId: string, intoPhone: string) {
  return write(viewer, async (db) => {
    const into = await byPhone(db, intoPhone);
    if (!into) throw notFound("No parent profile has that phone number.");
    if (into.id === fromId) throw badRequest("That is this profile's own number. Enter the number of the other profile.");
    const n = await db.rpc<number>("merge_parents", { p_from: fromId, p_into: into.id });
    return { message: `Merged into ${into.name}'s profile (${n} ${n === 1 ? "child" : "children"} moved).`, id: into.id };
  });
}

/** Link students who have a phone number but no family yet (normally the trigger does this on every save). */
export async function linkByPhone(viewer: Viewer) {
  const r = await write(viewer, (db) => db.rpc<{ created: number; linked: number }>("link_students_to_parents"));
  return {
    message:
      r.linked === 0
        ? "Every student with a phone number is already linked to a parent."
        : `${r.linked} ${r.linked === 1 ? "student" : "students"} linked; ${r.created} new parent ${r.created === 1 ? "profile" : "profiles"}.`,
  };
}

// ---------------------------------------------------------------------------------------------
// Calls
// ---------------------------------------------------------------------------------------------

/** Log a call about anything (any staff member). On a fee call, the promise decides when the family is called again. */
export async function logCall(viewer: Viewer, parentId: string, c: CallInput) {
  const callId = await orNotFound(
    write(viewer, (db) =>
      db.rpc<string>("log_parent_call", {
        p_parent: parentId,
        p_outcome: c.outcome,
        p_purpose: c.purpose,
        p_call_date: c.call_date,
        p_picked_by: c.picked_by,
        p_response: c.response,
        p_summary: c.summary,
        p_promised_date: c.promised_date,
        p_promised_amount: c.promised_amount,
        p_follow_up_on: c.follow_up_on,
      }),
    ),
    /^Parent not found/,
    "That parent does not exist.",
  );
  const promise = c.promised_date
    ? ` Promise: ${c.promised_amount ? rupees(c.promised_amount) : "payment"} by ${fmtDate(c.promised_date)}.`
    : c.follow_up_on
      ? ` Next call on ${fmtDate(c.follow_up_on)}.`
      : "";
  return { id: callId, message: `Call saved.${promise}` };
}

export async function deleteCall(viewer: Viewer, parentId: string, callId: string) {
  await write(viewer, async (db) => {
    const row = await db.one<{ call_date: string; outcome: string }>(
      "delete from public.parent_calls where id = $1 and parent_id = $2 returning call_date, outcome",
      [callId, parentId],
    );
    if (!row) throw notFound("That call no longer exists.");
    await audit(db, "delete_call", "parent_calls", callId, { parent: parentId, ...row });
  });
}

