import { redirect } from "next/navigation";
import { ChangePasswordForm } from "@/components/ChangePasswordForm";
import { currentUser } from "@/lib/server/auth";

export default async function AccountPage() {
  const me = await currentUser();
  if (!me) redirect("/login?next=/account");
  return (
    <div className="max-w-md space-y-6">
      <div>
        <h1 className="text-2xl">Account</h1>
        <p className="mt-1 text-sm text-neutral-600">
          Signed in as <span data-testid="account-email">{me.email}</span> ({me.role === "admin" ? "admin" : "member"}).
        </p>
      </div>
      <ChangePasswordForm />
    </div>
  );
}
