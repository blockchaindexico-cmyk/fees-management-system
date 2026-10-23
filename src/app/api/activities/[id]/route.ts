import { api, pathParam, readBody } from "@/server/http";
import { ActivityFields } from "@/server/schemas/recovery";
import { activity, deleteActivity, updateActivity } from "@/server/services/recovery";
import { id } from "@/server/validate";

type P = { id: string };

/** An activity with its students, their response and the receipts counted for it. */
export const GET = api<P>("staff", async ({ params, viewer }) => activity(viewer, pathParam(id(), params.id)));

/** Change the name, dates, target or status (close / reopen). */
export const PUT = api<P>("writer", async ({ req, params, viewer }) => updateActivity(viewer, pathParam(id(), params.id), await readBody(req, ActivityFields)));

/** Delete an activity no receipt is counted for. */
export const DELETE = api<P>("writer", async ({ params, viewer }) => deleteActivity(viewer, pathParam(id(), params.id)));
