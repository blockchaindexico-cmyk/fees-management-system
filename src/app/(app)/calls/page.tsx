import { CallsView } from "./calls-view";

export const metadata = { title: "Calls" };

export default async function CallsPage({ searchParams }: PageProps<"/calls">) {
  return <CallsView sp={await searchParams} />;
}
