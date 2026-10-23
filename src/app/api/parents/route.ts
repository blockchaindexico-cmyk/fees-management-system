import { z } from "zod";
import { api, readBody, readQuery } from "@/server/http";
import { ParentFields } from "@/server/schemas/recovery";
import { create, list } from "@/server/services/parents";
import { id } from "@/server/validate";

const Query = z.object({ session: id("Choose a session.") });

/** Every family (parent profile) with the children's balances in `session` added up. */
export const GET = api("staff", ({ req, viewer }) => list(viewer, readQuery(req, Query).session));

/** Add a parent profile; students who already have its phone number join it. */
export const POST = api("writer", async ({ req, viewer }) => create(viewer, await readBody(req, ParentFields)));
