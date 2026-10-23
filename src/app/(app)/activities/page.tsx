import { ActivitiesView } from "./activities-view";

export const metadata = { title: "Activities" };

export default async function ActivitiesPage({ searchParams }: PageProps<"/activities">) {
  return <ActivitiesView sp={await searchParams} />;
}
