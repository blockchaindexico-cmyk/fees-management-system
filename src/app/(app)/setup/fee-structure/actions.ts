"use server";

import { revalidatePath } from "next/cache";
import { requireWriter } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { friendlyError, type ActionState } from "@/lib/action-state";
import { parseRupees } from "@/lib/format";
import { plural } from "../_lib/text";

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const cellKey = (headId: string, instId: string) => `${headId}|${instId}`;

async function sessionInstallments(supabase: Awaited<ReturnType<typeof createClient>>, sessionId: string) {
  const { data, error } = await supabase.from("installments").select("id, number, name").eq("session_id", sessionId);
  if (error) throw new Error(error.message);
  return (data ?? []) as { id: string; number: number; name: string }[];
}

export async function saveStructure(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requireWriter();
  const sessionId = str(fd, "session_id");
  const classId = str(fd, "class_id");
  let cells: { installment_id: string; fee_head_id: string; amount: string }[];
  try {
    cells = JSON.parse(str(fd, "cells") || "[]");
    if (!Array.isArray(cells)) throw new Error();
  } catch {
    return { error: "Could not read the amounts." };
  }

  const supabase = await createClient();
  const [inst, headsRes] = await Promise.all([
    sessionInstallments(supabase, sessionId),
    supabase.from("fee_heads").select("id, name"),
  ]);
  const instById = new Map(inst.map((i) => [i.id, i]));
  const headById = new Map(((headsRes.data ?? []) as { id: string; name: string }[]).map((h) => [h.id, h]));

  const upserts: { class_id: string; installment_id: string; fee_head_id: string; amount: number }[] = [];
  const zeroByHead = new Map<string, string[]>();
  for (const c of cells) {
    const i = instById.get(c.installment_id);
    const h = headById.get(c.fee_head_id);
    if (!i || !h) return { error: "The page is out of date. Reload it and try again." };
    const raw = String(c.amount ?? "").trim();
    const paise = raw === "" ? 0 : parseRupees(raw);
    if (paise === null || paise < 0) return { error: `Check the amount for ${h.name}, ${i.name}: “${raw}” is not a valid rupee amount.` };
    if (paise > 0) upserts.push({ class_id: classId, installment_id: i.id, fee_head_id: h.id, amount: paise });
    else zeroByHead.set(h.id, [...(zeroByHead.get(h.id) ?? []), i.id]);
  }

  if (upserts.length) {
    const { error } = await supabase.from("fee_structures").upsert(upserts, { onConflict: "class_id,installment_id,fee_head_id" });
    if (error) return { error: friendlyError(error) };
  }
  for (const [headId, instIds] of zeroByHead) {
    const { error } = await supabase
      .from("fee_structures")
      .delete()
      .eq("class_id", classId)
      .eq("fee_head_id", headId)
      .in("installment_id", instIds);
    if (error) return { error: friendlyError(error) };
  }

  revalidatePath("/setup/fee-structure");
  revalidatePath("/setup");
  return {
    ok: true,
    message: `Saved ${plural(upserts.length, "amount")}. Students' charges change only when you apply the structure below.`,
  };
}

export async function copyStructure(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requireWriter();
  const sessionId = str(fd, "session_id");
  const classId = str(fd, "class_id");
  const fromId = str(fd, "from_class");
  if (!fromId) return { error: "Choose the class to copy from." };
  if (fromId === classId) return { error: "Choose a different class to copy from." };

  const supabase = await createClient();
  const inst = await sessionInstallments(supabase, sessionId);
  const instIds = inst.map((i) => i.id);
  if (instIds.length === 0) return { error: "This session has no installments." };

  const [srcRes, dstRes, fromRes] = await Promise.all([
    supabase.from("fee_structures").select("installment_id, fee_head_id, amount").eq("class_id", fromId).in("installment_id", instIds),
    supabase.from("fee_structures").select("id, installment_id, fee_head_id").eq("class_id", classId).in("installment_id", instIds),
    supabase.from("classes").select("name").eq("id", fromId).maybeSingle(),
  ]);
  if (srcRes.error) return { error: friendlyError(srcRes.error) };
  const src = (srcRes.data ?? []) as { installment_id: string; fee_head_id: string; amount: number }[];
  const fromName = fromRes.data?.name ?? "that class";
  if (src.length === 0) return { error: `${fromName} has no amounts in this session to copy.` };

  // upsert first, then remove extras, so a failure never leaves the class empty
  const { error: upErr } = await supabase.from("fee_structures").upsert(
    src.map((r) => ({ class_id: classId, installment_id: r.installment_id, fee_head_id: r.fee_head_id, amount: r.amount })),
    { onConflict: "class_id,installment_id,fee_head_id" },
  );
  if (upErr) return { error: friendlyError(upErr) };
  const keep = new Set(src.map((r) => cellKey(r.fee_head_id, r.installment_id)));
  const extra = ((dstRes.data ?? []) as { id: string; installment_id: string; fee_head_id: string }[])
    .filter((r) => !keep.has(cellKey(r.fee_head_id, r.installment_id)))
    .map((r) => r.id);
  if (extra.length) {
    const { error } = await supabase.from("fee_structures").delete().in("id", extra);
    if (error) return { error: friendlyError(error) };
  }

  revalidatePath("/setup/fee-structure");
  revalidatePath("/setup");
  const amounts: Record<string, number> = {};
  for (const r of src) amounts[cellKey(r.fee_head_id, r.installment_id)] = Number(r.amount);
  return { ok: true, message: `Copied ${plural(src.length, "amount")} from ${fromName}.`, data: amounts };
}

export async function applyStructure(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requireWriter();
  const sessionId = str(fd, "session_id");
  const all = str(fd, "intent") === "all";
  const classId = all ? null : str(fd, "class_id");
  const overwrite = fd.get("overwrite") === "on";
  const className = str(fd, "class_name");

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("generate_charges", {
    p_session: sessionId,
    p_class: classId,
    p_student: null,
    p_overwrite: overwrite,
  });
  if (error) return { error: friendlyError(error) };
  const n = Number(data ?? 0);

  revalidatePath("/", "layout");
  const target = all ? "all classes" : className || "the class";
  return {
    ok: true,
    message:
      n === 0
        ? `Nothing to change in ${target}: no student was missing a charge${overwrite ? " or had a different amount" : ""}.`
        : `Applied to ${target}: ${plural(n, "charge line")} added${overwrite ? ", updated or removed" : ""}.`,
  };
}
