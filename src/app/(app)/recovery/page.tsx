import { RecoveryView } from "./recovery-view";

export const metadata = { title: "Fee recovery" };

export default async function RecoveryPage({ searchParams }: PageProps<"/recovery">) {
  return <RecoveryView sp={await searchParams} />;
}
