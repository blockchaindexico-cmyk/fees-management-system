import { api } from "@/server/http";
import { callBoard } from "@/server/services/recovery";

/** Today's call list (with who took which family), every call made today and the viewer's own figures. */
export const GET = api("staff", ({ viewer }) => callBoard(viewer));
