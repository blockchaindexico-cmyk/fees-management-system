import { api, pathParam, readBody } from "@/server/http";
import { ParticipantsBody } from "@/server/schemas/recovery";
import { addParticipants } from "@/server/services/recovery";
import { id } from "@/server/validate";

/** Add students to an activity: chosen students and / or a whole class (section), optionally only those who owe. */
export const POST = api<{ id: string }>("writer", async ({ req, params, viewer }) =>
  addParticipants(viewer, pathParam(id(), params.id), await readBody(req, ParticipantsBody)),
);
