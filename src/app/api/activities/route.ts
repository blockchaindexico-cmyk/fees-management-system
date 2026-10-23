import { z } from "zod";
import { api, readBody, readQuery } from "@/server/http";
import { ActivityCreateBody } from "@/server/schemas/recovery";
import { activities, createActivity, runningActivities } from "@/server/services/recovery";
import { flag } from "@/server/validate";

/** Every activity with how it is doing, by class and by student; `running=1` only the running ones, without figures. */
export const GET = api("staff", ({ req, viewer }) =>
  readQuery(req, z.object({ running: flag(false) })).running ? runningActivities(viewer) : activities(viewer),
);

/** Start a student activity (optionally with `student_ids` taking part from the start). */
export const POST = api("writer", async ({ req, viewer }) => {
  const { student_ids, ...fields } = await readBody(req, ActivityCreateBody);
  return createActivity(viewer, fields, [...new Set(student_ids)]);
});
