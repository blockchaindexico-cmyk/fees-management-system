import { api } from "@/server/http";
import { linkByPhone } from "@/server/services/parents";

/** Link students that have a phone number but no family yet. */
export const POST = api("writer", ({ viewer }) => linkByPhone(viewer));
