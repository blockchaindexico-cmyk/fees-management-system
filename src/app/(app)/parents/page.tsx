import { ParentsView } from "./parents-view";

export const metadata = { title: "Parents" };

export default async function ParentsPage({ searchParams }: PageProps<"/parents">) {
  return <ParentsView sp={await searchParams} />;
}
