import { Suspense } from "react";
import { LoginForm } from "@/components/LoginForm";

export default function LoginPage() {
  return (
    <div className="mx-auto mt-16 max-w-sm space-y-6">
      <div>
        <h1 className="text-2xl">RepScore Search</h1>
        <p className="mt-1 text-sm text-neutral-600">Sign in with the account an admin created for you.</p>
      </div>
      <Suspense>
        <LoginForm />
      </Suspense>
    </div>
  );
}
