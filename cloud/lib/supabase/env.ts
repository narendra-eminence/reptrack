/** Supabase settings. The URL and anon (publishable) key are public; the service-role (secret) key is server-only. */
export function supabaseUrl(): string {
  return required("NEXT_PUBLIC_SUPABASE_URL", process.env.NEXT_PUBLIC_SUPABASE_URL);
}

export function supabaseAnonKey(): string {
  return required(
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (or NEXT_PUBLIC_SUPABASE_ANON_KEY)",
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  );
}

function required(name: string, value: string | undefined): string {
  if (!value) throw new Error(`${name} is not set. See .env.example.`);
  return value;
}

export { required };
