import { z } from "zod";
import { api, pathParam, readBody } from "@/server/http";
import { addChild } from "@/server/services/parents";
import { id } from "@/server/validate";

const Body = z.object({ student_id: id("Choose a student.") });

/** Move a student into this family. */
export const POST = api<{ id: string }>("writer", async ({ req, params, viewer }) =>
  addChild(viewer, pathParam(id(), params.id), (await readBody(req, Body)).student_id),
);
