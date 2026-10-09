import { expect, test } from "@playwright/test";
import { ADMIN, newSession, signIn } from "./helpers";

test.describe.configure({ mode: "serial" });

const MEMBER = { email: "member@e2e.test", password: "member-password-1" };

test("an admin adds a member, who can sign in", async ({ page, browser }) => {
  await signIn(page, ADMIN);
  await page.getByRole("link", { name: "Users" }).click();
  await expect(page.getByRole("heading", { name: "Users" })).toBeVisible();
  const form = page.getByRole("form", { name: "Add a user" });

  await form.getByLabel("Email").fill(MEMBER.email);
  await form.getByLabel("Password").fill("short");
  await form.getByRole("button", { name: "Add user" }).click();
  await expect(form.getByRole("alert")).toHaveText("The password needs at least 10 characters.");

  await form.getByLabel("Password").fill(MEMBER.password);
  await form.getByRole("button", { name: "Add user" }).click();
  await expect(page.getByRole("status")).toHaveText(`${MEMBER.email} can now sign in.`);
  await expect(form.getByLabel("Email")).toHaveValue("");
  const row = page.getByTestId("user-row").filter({ hasText: MEMBER.email });
  await expect(row.getByLabel(`Role of ${MEMBER.email}`)).toHaveValue("member");
  await expect(row.getByText("Never")).toBeVisible();

  await form.getByLabel("Email").fill(MEMBER.email.toUpperCase());
  await form.getByLabel("Password").fill(MEMBER.password);
  await form.getByRole("button", { name: "Add user" }).click();
  await expect(form.getByRole("alert")).toHaveText(`${MEMBER.email} already has an account.`);

  const member = await newSession(browser, MEMBER);
  await expect(member.page.getByRole("link", { name: "Users" })).toHaveCount(0);
  await member.context.close();
  await page.reload();
  await expect(page.getByTestId("user-row").filter({ hasText: MEMBER.email }).getByText("Never")).toHaveCount(0);
  await page.screenshot({ path: "test-results/screens/users.png", fullPage: true });
});

test("members cannot reach user management", async ({ page }) => {
  await signIn(page, MEMBER);
  const res = await page.goto("/admin/users");
  expect(res?.status()).toBe(404);
  const api = page.request;
  expect((await api.get("/api/admin/users")).status()).toBe(403);
  expect((await api.post("/api/admin/users", { data: { email: "x@e2e.test", password: "long-enough-1", role: "admin" } })).status()).toBe(403);
});

test("an admin cannot demote or remove themselves", async ({ page }) => {
  await signIn(page, ADMIN, "/admin/users");
  const self = page.getByTestId("user-row").filter({ hasText: `${ADMIN.email} (you)` });
  await expect(self.getByLabel(`Role of ${ADMIN.email}`)).toBeDisabled();
  await expect(self.getByRole("button", { name: "Remove" })).toHaveCount(0);
  const users = await (await page.request.get("/api/admin/users")).json();
  const me = users.find((u: { email: string }) => u.email === ADMIN.email);
  const demote = await page.request.patch(`/api/admin/users/${me.id}`, { data: { role: "member" } });
  expect(demote.status()).toBe(409);
  expect((await page.request.delete(`/api/admin/users/${me.id}`)).status()).toBe(409);
});

test("an admin sets a member's password; the old one and open sessions stop working", async ({ page, browser }) => {
  const open = await newSession(browser, MEMBER);
  await signIn(page, ADMIN, "/admin/users");
  const row = page.getByTestId("user-row").filter({ hasText: MEMBER.email });
  await row.getByRole("button", { name: "Set password" }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog.getByRole("heading")).toHaveText(`New password for ${MEMBER.email}`);
  await dialog.getByLabel("New password").fill("member-password-2");
  await dialog.getByRole("button", { name: "Set password" }).click();
  await expect(page.getByRole("status")).toHaveText(`New password set for ${MEMBER.email}.`);
  MEMBER.password = "member-password-2";
  await open.page.goto("/");
  await expect(open.page).toHaveURL(/\/login/);
  await open.context.close();

  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  await p.goto("/login");
  await p.getByLabel("Email").fill(MEMBER.email);
  await p.getByLabel("Password").fill("member-password-1");
  await p.getByRole("button", { name: "Sign in" }).click();
  await expect(p.locator("main").getByRole("alert")).toHaveText("Wrong email or password.");
  await ctx.close();
  const member = await newSession(browser, MEMBER);
  await member.context.close();
});

test("a member changes their own password after giving the current one", async ({ page, browser }) => {
  const elsewhere = await newSession(browser, MEMBER);
  await signIn(page, MEMBER);
  await page.getByTestId("account-link").click();
  await expect(page.getByTestId("account-email")).toHaveText(MEMBER.email);
  const form = page.getByRole("form", { name: "Change password" });
  await form.getByLabel("Current password").fill("wrong-password-9");
  await form.getByLabel("New password", { exact: true }).fill("member-password-3");
  await form.getByLabel("New password again").fill("member-password-3");
  await form.getByRole("button", { name: "Change password" }).click();
  await expect(form.getByRole("alert")).toHaveText("Your current password is not right.");

  await form.getByLabel("Current password").fill(MEMBER.password);
  await form.getByLabel("New password again").fill("member-password-4");
  await form.getByRole("button", { name: "Change password" }).click();
  await expect(form.getByRole("alert")).toHaveText("The two new passwords are different.");

  await form.getByLabel("New password again").fill("member-password-3");
  await form.getByRole("button", { name: "Change password" }).click();
  await expect(form.getByRole("status")).toHaveText("Password changed. Any other devices were signed out.");
  MEMBER.password = "member-password-3";
  // Still signed in here; and the new password works elsewhere.
  await page.reload();
  await expect(page.getByTestId("account-email")).toHaveText(MEMBER.email);
  await page.screenshot({ path: "test-results/screens/account.png" });
  await elsewhere.page.goto("/");
  await expect(elsewhere.page).toHaveURL(/\/login/);
  await elsewhere.context.close();
  const other = await newSession(browser, MEMBER);
  await other.context.close();
});

test("promoting a member gives them the Users page; removing them ends their access", async ({ page, browser }) => {
  await signIn(page, ADMIN, "/admin/users");
  const row = page.getByTestId("user-row").filter({ hasText: MEMBER.email });
  await row.getByLabel(`Role of ${MEMBER.email}`).selectOption("admin");
  await expect(page.getByRole("status")).toHaveText(`${MEMBER.email} is now an admin.`);
  const member = await newSession(browser, MEMBER);
  await expect(member.page.getByRole("link", { name: "Users" })).toBeVisible();

  await row.getByLabel(`Role of ${MEMBER.email}`).selectOption("member");
  await expect(page.getByRole("status")).toHaveText(`${MEMBER.email} is now a member.`);
  await row.getByRole("button", { name: "Remove" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Remove" }).click();
  await expect(page.getByRole("status")).toHaveText(`${MEMBER.email} was removed.`);
  await expect(page.getByTestId("user-row").filter({ hasText: MEMBER.email })).toHaveCount(0);

  // Their open session can no longer use the app.
  expect((await member.page.request.get("/api/runs")).status()).toBeGreaterThanOrEqual(401);
  await member.page.goto("/");
  await expect(member.page).toHaveURL(/\/login/);
  await member.context.close();
});
