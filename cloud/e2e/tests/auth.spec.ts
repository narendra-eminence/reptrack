import { expect, test } from "@playwright/test";
import { ADMIN, signIn } from "./helpers";

test("signed-out visitors go to the login page, which has no sign-up", async ({ page }) => {
  await page.goto("/runs/new");
  await expect(page).toHaveURL(/\/login\?next=%2Fruns%2Fnew$/);
  await expect(page.getByRole("heading", { name: "RepScore Search" })).toBeVisible();
  await expect(page.getByText("There is no sign-up.")).toBeVisible();
  await expect(page.getByRole("link", { name: /sign up|register|create account/i })).toHaveCount(0);
  await expect(page.getByRole("banner")).toHaveCount(0); // no app header before sign-in
  await page.screenshot({ path: "test-results/screens/login.png" });
});

test("a wrong password is refused without saying which part was wrong", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(ADMIN.email);
  await page.getByLabel("Password").fill("not-the-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.locator("main").getByRole("alert")).toHaveText("Wrong email or password.");
  await page.getByLabel("Email").fill("nobody@e2e.test");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.locator("main").getByRole("alert")).toHaveText("Wrong email or password.");
});

test("signing in returns to the page asked for; signing out ends the session", async ({ page }) => {
  await signIn(page, ADMIN, "/runs/new");
  await expect(page).toHaveURL(/\/runs\/new$/);
  await expect(page.getByRole("link", { name: "Users" })).toBeVisible();
  // A crafted next= cannot send anyone to another site.
  await page.goto("/login?next=//evil.example.com");
  await expect(page).toHaveURL(/localhost:3200\/$/); // already signed in: the proxy sends /login to /
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/); // "/" needs no next=
});

test("the API refuses signed-out callers", async ({ request }) => {
  expect((await request.get("/api/runs")).status()).toBe(401);
  expect((await request.post("/api/runs", { data: {} })).status()).toBe(401);
  expect((await request.post("/api/plan", { data: {} })).status()).toBe(401);
  expect((await request.get("/api/admin/users")).status()).toBe(401);
  const body = await (await request.get("/api/runs")).json();
  expect(body.error).toMatch(/signed out/);
});

test("Supabase itself refuses sign-ups", async ({ request }) => {
  const res = await request.post(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/signup`, {
    headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, "Content-Type": "application/json" },
    data: { email: "intruder@e2e.test", password: "intruder-password-1" },
  });
  expect(res.status()).toBeGreaterThanOrEqual(400);
  expect(await res.text()).toMatch(/signups not allowed/i);
});

test("the browser's anon key can read nothing signed out and write nothing signed in", async ({ request }) => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const h = { apikey: anon, Authorization: `Bearer ${anon}` };
  expect(await (await request.get(`${url}/rest/v1/runs?select=id`, { headers: h })).json()).toEqual([]);
  expect(await (await request.get(`${url}/rest/v1/profiles?select=id`, { headers: h })).json()).toEqual([]);
  // Signed in as the admin, straight against Supabase: reads work, writes and the step functions do not.
  const tok = await request.post(`${url}/auth/v1/token?grant_type=password`, { headers: { apikey: anon }, data: ADMIN });
  const { access_token } = await tok.json();
  const user = { apikey: anon, Authorization: `Bearer ${access_token}`, "Content-Type": "application/json" };
  expect((await request.get(`${url}/rest/v1/runs?select=id`, { headers: user })).ok()).toBe(true);
  const write = await request.post(`${url}/rest/v1/runs`, {
    headers: user,
    data: { name: "x", vertical: "web", region: "in", pages: 1, max_calls: 1 },
  });
  expect(write.ok()).toBe(false);
  const cache = await request.get(`${url}/rest/v1/serp_cache?select=key`, { headers: user });
  expect(await cache.json()).toEqual([]);
  const rpc = await request.post(`${url}/rest/v1/rpc/resume_run`, { headers: user, data: { p_run: "00000000-0000-0000-0000-000000000000" } });
  expect(rpc.ok()).toBe(false);
  const promote = await request.patch(`${url}/rest/v1/profiles?email=eq.${ADMIN.email}`, { headers: user, data: { role: "member" } });
  expect(promote.ok() && (await promote.text()).length > 2).toBe(false);
});
