import { notFound, redirect } from "next/navigation";
import { UsersAdmin } from "@/components/UsersAdmin";
import { currentUser } from "@/lib/server/auth";

export default async function UsersPage() {
  const me = await currentUser();
  if (!me) redirect("/login?next=/admin/users");
  if (me.role !== "admin") notFound();
  return <UsersAdmin me={me} />;
}
