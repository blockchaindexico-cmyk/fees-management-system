import { api, readBody } from "@/server/http";
import { ReleaseCallsBody } from "@/server/schemas/recovery";
import { releaseCalls } from "@/server/services/recovery";

/** Give a family (or every family of mine not called yet) back to today's list. */
export const POST = api("staff", async ({ req, viewer }) => releaseCalls(viewer, (await readBody(req, ReleaseCallsBody)).parent_id ?? null));
