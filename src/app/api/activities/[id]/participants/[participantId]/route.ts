import { api, pathParam, readBody } from "@/server/http";
import { ParticipantPatch } from "@/server/schemas/recovery";
import { removeParticipant, updateParticipant } from "@/server/services/recovery";
import { id } from "@/server/validate";

type P = { id: string; participantId: string };

/** Record a student's response (fees deposited, part, declined) with a note. */
export const PATCH = api<P>("writer", async ({ req, params, viewer }) =>
  updateParticipant(viewer, pathParam(id(), params.id), pathParam(id(), params.participantId), await readBody(req, ParticipantPatch)),
);

/** Take a student out of the activity (receipts counted for it are released). */
export const DELETE = api<P>("writer", async ({ params, viewer }) =>
  removeParticipant(viewer, pathParam(id(), params.id), pathParam(id(), params.participantId)),
);
