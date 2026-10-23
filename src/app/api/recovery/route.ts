import { api, readQuery } from "@/server/http";
import { PeriodQuery } from "@/server/schemas/recovery";
import { dashboard } from "@/server/services/recovery";

/** The recovery dashboard for a period: money received and what brought it in, calls, their effect and activities. */
export const GET = api("staff", ({ req, viewer }) => {
  const { from, to } = readQuery(req, PeriodQuery);
  return dashboard(viewer, from, to);
});
