import { notFound } from "next/navigation";
import { isUuid } from "../../students/helpers";
import { ParentView } from "./parent-view";

export const metadata = { title: "Parent" };

export default async function ParentPage({ params }: PageProps<"/parents/[id]">) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  return <ParentView id={id} />;
}
