-- RepScore Search: users and roles, search runs, their queries and results, and a 30-day cache of SerpAPI pages.
--
-- Every write goes through the app's server routes with the service-role key, after the route has checked who is
-- signed in. The browser never writes to these tables: row-level security allows signed-in users to read and
-- nothing else, so a leaked anon key or session cannot change data or spend SerpAPI credits.

create type public.user_role as enum ('admin', 'member');

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  role public.user_role not null default 'member',
  created_at timestamptz not null default now()
);

-- Every account gets a profile; accounts are only ever created by an admin (sign-ups are off).
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, email) values (new.id, coalesce(new.email, ''));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

create table public.runs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  vertical text not null check (vertical in ('web', 'news', 'news_tab')),
  region text not null check (region in ('in', 'us')),
  pages integer not null check (pages between 1 and 50),
  start_date date,
  end_date date,
  -- pending: nothing claimed yet; running: queries being worked; done: none left; cancelled: stopped by a user.
  status text not null default 'pending' check (status in ('pending', 'running', 'done', 'cancelled')),
  max_calls integer not null check (max_calls >= 0),
  created_by uuid references auth.users (id) on delete set null,
  created_by_email text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint runs_window_complete check ((start_date is null) = (end_date is null)),
  constraint runs_window_order check (start_date is null or start_date <= end_date)
);
create index runs_created_at on public.runs (created_at desc);

create table public.queries (
  id bigint generated always as identity primary key,
  run_id uuid not null references public.runs (id) on delete cascade,
  position integer not null,
  text text not null,
  state text not null default 'pending' check (state in ('pending', 'running', 'done', 'failed')),
  found integer,
  out_of_range integer,
  attempts integer,
  calls integer, -- billable SerpAPI calls made (cache hits are free)
  error text,
  started_at timestamptz,
  finished_at timestamptz,
  unique (run_id, position)
);
create index queries_run_state on public.queries (run_id, state, position);

create table public.serp_rows (
  id bigint generated always as identity primary key,
  run_id uuid not null references public.runs (id) on delete cascade,
  query_id bigint not null references public.queries (id) on delete cascade,
  query_position integer not null,
  seq integer not null,
  query text not null,
  vertical text not null,
  provider text not null default 'serpapi',
  page integer not null,
  rank integer not null,
  title text not null default '',
  link text not null,
  domain text not null default '',
  date text not null default '',
  published date,
  out_of_range boolean,
  range_start date,
  range_end date,
  snippet text not null default '',
  outlet text not null default '',
  fetched_at timestamptz not null,
  search_text text generated always as (
    lower(query || ' ' || title || ' ' || link || ' ' || snippet || ' ' || outlet || ' ' || domain || ' ' || date)
  ) stored
);
create index serp_rows_run_order on public.serp_rows (run_id, query_position, seq);

-- One SerpAPI page per row. Repeating an identical request within 30 days is served from here at no cost.
create table public.serp_cache (
  key text primary key,
  response jsonb not null,
  created_at timestamptz not null default now()
);

-- Run list and run header numbers in one place.
create view public.run_overview with (security_invoker = true) as
select
  r.*,
  coalesce(q.total, 0) as query_count,
  coalesce(q.done, 0) as done_count,
  coalesce(q.failed, 0) as failed_count,
  coalesce(q.pending, 0) as pending_count,
  coalesce(q.running, 0) as running_count,
  coalesce(q.calls, 0) as calls_used,
  coalesce(q.found, 0) as row_count,
  coalesce(q.out_of_range, 0) as out_of_range_count
from public.runs r
left join lateral (
  select
    count(*) as total,
    count(*) filter (where state = 'done') as done,
    count(*) filter (where state = 'failed') as failed,
    count(*) filter (where state = 'pending') as pending,
    count(*) filter (where state = 'running') as running,
    sum(calls) as calls,
    sum(found) as found,
    sum(out_of_range) as out_of_range
  from public.queries where run_id = r.id
) q on true;

-- Claim the next query of a run to search. A query left 'running' longer than p_stale_seconds belongs to a step
-- that died (a closed tab cannot kill a running server step, but a crash or deploy can), so it is claimed again.
-- skip locked lets several browser workers claim in parallel without taking the same query.
create function public.claim_next_query(p_run uuid, p_stale_seconds integer default 330)
returns setof public.queries
language plpgsql security definer set search_path = '' as $$
declare
  claimed public.queries;
begin
  perform 1 from public.runs where id = p_run and status in ('pending', 'running') for update;
  if not found then
    return;
  end if;
  update public.queries q
     set state = 'running', started_at = now(), finished_at = null
   where q.id = (
     select id from public.queries
      where run_id = p_run
        and (state = 'pending'
             or (state = 'running' and started_at < now() - make_interval(secs => p_stale_seconds)))
      order by position
      limit 1
      for update skip locked)
  returning q.* into claimed;
  if claimed.id is null then
    return;
  end if;
  update public.runs set status = 'running', updated_at = now() where id = p_run;
  return next claimed;
end;
$$;

-- Store one query's outcome atomically: its rows replace any earlier attempt's, the query gets its final state,
-- and the run is marked done once nothing is left to search. A stopped run stays stopped while work remains.
create function public.finish_query(
  p_query bigint, p_state text, p_attempts integer, p_calls integer, p_error text, p_rows jsonb
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  q public.queries;
  v_run uuid;
begin
  if p_state not in ('done', 'failed') then
    raise exception 'finish_query: state must be done or failed, not %', p_state;
  end if;
  select run_id into v_run from public.queries where id = p_query;
  if v_run is null then
    raise exception 'finish_query: no query %', p_query;
  end if;
  -- Lock the run first (the same order as claim_next_query), so queries of one run finish one at a time. Without
  -- it, two queries finishing together each still see the other as running and neither marks the run done.
  perform 1 from public.runs where id = v_run for update;
  select * into q from public.queries where id = p_query for update;
  delete from public.serp_rows where query_id = q.id;
  insert into public.serp_rows (
    run_id, query_id, query_position, seq, query, vertical, provider, page, rank, title, link, domain, date,
    published, out_of_range, range_start, range_end, snippet, outlet, fetched_at)
  select q.run_id, q.id, q.position, (e.ord - 1)::integer, r.query, r.vertical, r.provider, r.page, r.rank, r.title,
         r.link, r.domain, r.date, r.published, r.out_of_range, nullif(r.range_start, '')::date,
         nullif(r.range_end, '')::date, r.snippet, r.outlet, r.fetched_at
    from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) with ordinality as e(item, ord)
    cross join lateral jsonb_to_record(e.item) as r(
      query text, vertical text, provider text, page integer, rank integer, title text, link text, domain text,
      date text, published date, out_of_range boolean, range_start text, range_end text, snippet text,
      outlet text, fetched_at timestamptz);
  update public.queries
     set state = p_state,
         found = jsonb_array_length(coalesce(p_rows, '[]'::jsonb)),
         out_of_range = (select count(*) from public.serp_rows where query_id = q.id and out_of_range),
         attempts = coalesce(attempts, 0) + p_attempts,
         calls = coalesce(calls, 0) + p_calls,
         error = nullif(p_error, ''),
         finished_at = now()
   where id = q.id;
  update public.runs
     set status = case
           when not exists (select 1 from public.queries where run_id = q.run_id and state in ('pending', 'running'))
             then 'done' -- also a run stopped while its last queries were finishing: nothing is left to resume
           when status = 'cancelled' then status
           else 'running' end,
         updated_at = now()
   where id = q.run_id;
end;
$$;

-- Resume a run: failed queries go back in line (unless p_include_failed is false), and a cancelled run is
-- reopened. Queries still 'running' are left alone: if their step died, claim_next_query takes them back once
-- they are stale, and if it is alive it must not be duplicated.
create function public.resume_run(p_run uuid, p_include_failed boolean default true) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  n integer;
begin
  perform 1 from public.runs where id = p_run for update;
  update public.queries set state = 'pending', error = null
   where run_id = p_run and p_include_failed and state = 'failed';
  get diagnostics n = row_count;
  update public.runs
     set status = case
           when exists (select 1 from public.queries where run_id = p_run and state in ('pending', 'running'))
             then 'running'
           else 'done' end,
         updated_at = now()
   where id = p_run;
  return n;
end;
$$;

-- Read access for signed-in users; no writes from the browser at all.
alter table public.profiles enable row level security;
alter table public.runs enable row level security;
alter table public.queries enable row level security;
alter table public.serp_rows enable row level security;
alter table public.serp_cache enable row level security;

create policy "own profile, or every profile for admins" on public.profiles
  for select to authenticated using (id = auth.uid() or public.is_admin());
create policy "signed-in users read runs" on public.runs for select to authenticated using (true);
create policy "signed-in users read queries" on public.queries for select to authenticated using (true);
create policy "signed-in users read results" on public.serp_rows for select to authenticated using (true);
-- serp_cache: no policy, so only the service role reaches it.

revoke execute on function public.claim_next_query(uuid, integer) from public, anon, authenticated;
revoke execute on function public.finish_query(bigint, text, integer, integer, text, jsonb) from public, anon, authenticated;
revoke execute on function public.resume_run(uuid, boolean) from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
grant execute on function public.claim_next_query(uuid, integer) to service_role;
grant execute on function public.finish_query(bigint, text, integer, integer, text, jsonb) to service_role;
grant execute on function public.resume_run(uuid, boolean) to service_role;
