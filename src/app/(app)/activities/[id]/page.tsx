import { notFound } from "next/navigation";
import { param } from "@/lib/context";
import { isUuid } from "../../students/helpers";
import { ActivityView } from "./activity-view";

export const metadata = { title: "Activity" };

export default async function ActivityPage({ params, searchParams }: PageProps<"/activities/[id]">) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  return <ActivityView id={id} tab={param((await searchParams).tab)} />;
}
