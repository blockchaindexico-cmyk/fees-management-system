import { api, pathParam } from "@/server/http";
import { deleteCall } from "@/server/services/parents";
import { id } from "@/server/validate";

export const DELETE = api<{ id: string; callId: string }>("writer", async ({ params, viewer }) =>
  deleteCall(viewer, pathParam(id(), params.id), pathParam(id(), params.callId)),
);
