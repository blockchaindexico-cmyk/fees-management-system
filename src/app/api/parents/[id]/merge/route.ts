import { z } from "zod";
import { api, pathParam, readBody } from "@/server/http";
import { merge } from "@/server/services/parents";
import { id, requiredText } from "@/server/validate";

const Body = z.object({ phone: requiredText("Enter the phone number of the profile to merge into.", 50) });

/** Merge this profile into the one with `phone` (children and calls move there). */
export const POST = api<{ id: string }>("writer", async ({ req, params, viewer }) =>
  merge(viewer, pathParam(id(), params.id), (await readBody(req, Body)).phone),
);
