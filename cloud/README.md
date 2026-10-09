# RepScore Search (cloud)

The first step of the RepScore pipeline, the SerpAPI Google search, as a web app on Vercel with its history in
Supabase. It needs no Mac and no Python. It searches with SerpAPI only, and exports the same `_serp.xlsx` columns
as the local app's Bulk Search, so the file can go straight into the local Verify step.

Everything else in `repscore-pipeline` (verify, clean, brand sets) stays local and is not touched by this app.

## How it works

- **Accounts.** There is no sign-up. One admin is created from the command line; admins add everyone else on the
  Users page and can reset passwords, change roles and remove people. Every signed-in user can see every run.
- **A run** is a list of queries with a vertical (Web, News, News tab), region (India or US), pages per query and
  an optional date window. Before it starts, the app shows the most SerpAPI pages it can bill and how many are
  already cached; you confirm that number.
- **Searching happens while the run page is open.** Vercel functions stop after 300 s (Hobby), so the browser asks
  the server to search one query at a time, four in parallel. Each query and its results are saved as soon as it
  finishes. Closing the tab pauses the run; opening it again, or pressing Resume, carries on from where it
  stopped. A query whose step died is picked up again after 5.5 minutes. Two tabs on the same run share the
  work without searching anything twice.
- **Cache.** Every SerpAPI page is cached in Supabase for 30 days. Repeating a search within that time costs
  nothing.
- **Export.** "Download SERP xlsx" builds the file in the browser (Vercel caps responses at 4.5 MB).
- **Security.** The SerpAPI key and the Supabase service-role key live only on the server. The browser can read
  with the anon key only after sign-in (row-level security), and cannot write anything; every change goes
  through a server route that checks who is signed in first.

The search logic is a TypeScript port of Company Monitor's `bulk_search` (query parsing, date windows, paging,
retries, news clusters, published-date parsing, the out-of-range flag). `lib/serp/core.test.ts` checks it against
`lib/serp/__fixtures__/golden.json`, which `scripts/golden_from_company_monitor.py` generates from the Python
code itself.

## Set up

You need a Supabase project, a Vercel account, a SerpAPI key, and Node 20 or newer.

### 1. Supabase

1. Create a project at <https://supabase.com/dashboard>.
2. Apply the schema. Either paste `supabase/migrations/20261009000000_init.sql` into **SQL Editor** and run it, or
   with the CLI:

   ```sh
   cd cloud
   npx supabase login
   npx supabase link --project-ref <your-project-ref>
   npx supabase db push
   ```

3. Turn sign-ups off: **Authentication > Sign In / Providers**, switch off **Allow new users to sign up**. (The
   app has no sign-up page either, but this setting is what stops the public API from creating accounts.)
4. Note the project URL and, from **Project Settings > API Keys**, the publishable key (`sb_publishable_...`) and
   a secret key (`sb_secret_...`). Projects on the older keys can use the `anon` and `service_role` keys instead.

### 2. Local check and the first admin

```sh
cd cloud
npm install
cp .env.example .env.local   # fill in the four values (skip if .env.local exists)
npm run create-admin -- you@example.com
npm run dev                  # http://localhost:3000
```

`create-admin` asks for a password (at least 10 characters), or reads `ADMIN_PASSWORD`. Running it for an email
that already has an account makes that account an admin without changing its password.

### 3. Vercel

1. **Add New > Project**, import this repository, and set **Root Directory** to `cloud`. The framework is
   detected as Next.js; keep the default build settings.
2. Under **Environment Variables** add `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`,
   `SUPABASE_SECRET_KEY` and `SERPAPI_KEY` (Production and Preview). Do not set `SERPAPI_BASE_URL`.
3. Deploy, then sign in with the admin account and add users on the Users page.

On the Pro plan you can raise `maxDuration` in `app/api/runs/[id]/step/route.ts` and `STEP_BUDGET_MS` in
`lib/server/runs.ts`, but the defaults already suit queries of up to about 20 pages.

## Development

```sh
npm run typecheck
npm run lint
npm test            # unit tests, including the Company Monitor golden checks
npm run e2e         # Playwright, see below
```

The end-to-end tests need a Supabase instance with this schema (`npx supabase start` locally) and use a fake
SerpAPI server, so they spend no credits. Set the variables from `npx supabase status` and run `npm run e2e`.

Schema changes go in a new file under `supabase/migrations/`; never edit an applied migration.
