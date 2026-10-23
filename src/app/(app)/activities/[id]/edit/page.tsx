import { notFound } from "next/navigation";
import { isUuid } from "../../../students/helpers";
import { EditActivity } from "./edit-activity";

export const metadata = { title: "Edit activity" };

export default async function EditActivityPage({ params }: PageProps<"/activities/[id]/edit">) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  return <EditActivity id={id} />;
}
