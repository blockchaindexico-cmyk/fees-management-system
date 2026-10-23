import { api, readBody } from "@/server/http";
import { TakeCallsBody } from "@/server/schemas/recovery";
import { takeCalls } from "@/server/services/recovery";

/** Take families from today's list: the next `count` by priority, or the family `parent_id`. Any staff member. */
export const POST = api("staff", async ({ req, viewer }) => {
  const b = await readBody(req, TakeCallsBody);
  return takeCalls(viewer, b.count ?? null, b.parent_id ?? null);
});
