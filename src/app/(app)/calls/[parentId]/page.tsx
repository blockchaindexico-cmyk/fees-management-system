import { notFound } from "next/navigation";
import { isUuid } from "../../students/helpers";
import { CallView } from "./call-view";

export const metadata = { title: "Call" };

export default async function CallPage({ params }: PageProps<"/calls/[parentId]">) {
  const { parentId } = await params;
  if (!isUuid(parentId)) notFound();
  return <CallView parentId={parentId} />;
}
