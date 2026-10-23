import { api, readBody } from "@/server/http";
import { CallRulesBody } from "@/server/schemas/recovery";
import { updateCallRules } from "@/server/services/recovery";

/** The rules that build the daily call list, and the promise grace days. Admin only. */
export const PUT = api("admin", async ({ req, viewer }) => updateCallRules(viewer, await readBody(req, CallRulesBody)));
