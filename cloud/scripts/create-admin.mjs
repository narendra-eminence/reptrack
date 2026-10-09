#!/usr/bin/env node
// Create the first admin (or promote an existing account to admin). Sign-ups are off, so this is how the
// very first account comes to exist; that admin then adds everyone else from the Users page.
//
//   npm run create-admin -- you@example.com
//
// Reads NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from the environment or .env.local, and the
// password from ADMIN_PASSWORD or an interactive prompt (input hidden).
import { existsSync, readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { createClient } from "@supabase/supabase-js";

const MIN_PASSWORD = 10;

function loadEnvFile(path) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, "$2");
  }
}

function fail(message) {
  console.error(`create-admin: ${message}`);
  process.exit(1);
}

function askHidden(question) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (s) => {
      if (s.startsWith(question)) rl.output.write(s);
    };
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write("\n");
      resolve(answer);
    });
  });
}

loadEnvFile(".env.local");
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
if (!url || !serviceKey) fail("set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY (or put them in .env.local).");

const email = (process.argv[2] ?? "").trim().toLowerCase();
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail("usage: npm run create-admin -- you@example.com");

const db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

async function findUser(address) {
  for (let page = 1; ; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) fail(`could not list users: ${error.message}`);
    const hit = data.users.find((u) => (u.email ?? "").toLowerCase() === address);
    if (hit || data.users.length < 1000) return hit ?? null;
  }
}

let user = await findUser(email);
if (user) {
  console.log(`${email} already has an account; making it an admin (password unchanged).`);
} else {
  const password = process.env.ADMIN_PASSWORD ?? (await askHidden(`Password for ${email} (at least ${MIN_PASSWORD} characters): `));
  if (password.length < MIN_PASSWORD) fail(`the password needs at least ${MIN_PASSWORD} characters.`);
  const { data, error } = await db.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) fail(`could not create the account: ${error.message}`);
  user = data.user;
}

// The on_auth_user_created trigger makes the profile; upsert covers accounts made before the migration ran.
const { error } = await db.from("profiles").upsert({ id: user.id, email, role: "admin" });
if (error) fail(`account exists but could not be made admin: ${error.message}. Did the migration run?`);
console.log(`${email} is an admin. Sign in and add everyone else from the Users page.`);
