import { z } from "zod";
import { api, pathParam, readBody, readQuery } from "@/server/http";
import { ParentUpdateBody } from "@/server/schemas/recovery";
import { get360, remove, update } from "@/server/services/parents";
import { id } from "@/server/validate";

type P = { id: string };

/** Parent 360: children and family balances in `session` (default: the running one), payments, calls, promises. */
export const GET = api<P>("staff", async ({ req, params, viewer }) => {
  const { session } = readQuery(req, z.object({ session: id("Unknown session.").optional() }));
  return get360(viewer, pathParam(id(), params.id), session ?? null);
});

/** Save the profile (economic condition, payment habit, concerns, notes…). */
export const PUT = api<P>("writer", async ({ req, params, viewer }) => {
  const { update_children_phone, ...fields } = await readBody(req, ParentUpdateBody);
  return update(viewer, pathParam(id(), params.id), fields, update_children_phone);
});

/** Delete a profile with no children and no calls. */
export const DELETE = api<P>("writer", async ({ params, viewer }) => remove(viewer, pathParam(id(), params.id)));
