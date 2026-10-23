import { api, pathParam } from "@/server/http";
import { studentRecovery } from "@/server/services/recovery";
import { id } from "@/server/validate";

/** The student's family (parent profile, brothers and sisters, latest calls, promise) and their recovery activities. */
export const GET = api<{ id: string }>("staff", async ({ params, viewer }) => studentRecovery(viewer, pathParam(id(), params.id)));
