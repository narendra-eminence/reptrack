import { redirect } from "next/navigation";
import { RunView } from "@/components/RunView";
import { currentUser } from "@/lib/server/auth";

export default async function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await currentUser();
  if (!me) redirect("/login");
  const { id } = await params;
  return <RunView key={id} runId={id} me={me} />;
}
