import { api, pathParam, readBody } from "@/server/http";
import { CallBody } from "@/server/schemas/recovery";
import { logCall } from "@/server/services/parents";
import { id } from "@/server/validate";

/** Log a call to the family: who picked up, what they said, a promise or the next call date. Any staff member. */
export const POST = api<{ id: string }>("staff", async ({ req, params, viewer }) => logCall(viewer, pathParam(id(), params.id), await readBody(req, CallBody)));
