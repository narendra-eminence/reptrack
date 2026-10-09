import { requireAdmin } from "@/lib/server/auth";
import { body, handle, json } from "@/lib/server/http";
import { createUser, listUsers, validEmail, validPassword, validRole } from "@/lib/server/users";
import { adminClient } from "@/lib/supabase/server";

export async function GET() {
  return handle(async () => {
    await requireAdmin();
    return listUsers(adminClient());
  });
}

export async function POST(req: Request) {
  return handle(async () => {
    await requireAdmin();
    const input = await body<{ email?: unknown; password?: unknown; role?: unknown }>(req);
    const user = await createUser(adminClient(), validEmail(input.email), validPassword(input.password), validRole(input.role ?? "member"));
    return json(user, 201);
  });
}
