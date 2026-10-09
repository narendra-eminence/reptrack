"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Elapsed } from "@/components/Elapsed";
import { Button, buttonVariants } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { api, errorMessage } from "@/lib/api";
import { BUCKETS, DETAIL_FIELDS, REMOVED_SHEETS, duplicatesRemoved, hasOwnDetails } from "@/lib/cleaning";
import { fmt, fmtDateTime } from "@/lib/format";
import { useRunContext } from "@/lib/RunContext";
import { doneAvailable, stepHref } from "@/lib/steps";
import { useStepNavigation } from "@/lib/useStepNavigation";
import { cn } from "@/lib/utils";
import type { CleanJob, CleaningDetails, RunDetail } from "@/lib/types";

export function CleanStep({ run, refetch }: { run: RunDetail; refetch: () => Promise<void> }) {
  const navigate = useStepNavigation();
  const { getStepQuery } = useRunContext();
  // The Clean route is only reachable with a finished verification (stepAvailability(run).clean).
  const verification = run.verify_jobs.find((v) => v.status === "done")!;
  const brandSet = verification.brand_set;
  const [details, setDetails] = useState<{ set: string; details: CleaningDetails; saved: boolean } | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .cleaningDetails(brandSet)
      .then((r) => alive && setDetails({ set: brandSet, details: r.details, saved: r.saved }))
      .catch((e) => alive && setError(errorMessage(e)));
    return () => {
      alive = false;
    };
  }, [brandSet]);

  const latest = run.clean_jobs[0];
  const done = doneAvailable(run);
  const canContinue = done && !run.active_job;
  const shown = details?.set === brandSet ? details : null;

  async function start() {
    setStarting(true);
    setError(null);
    try {
      await api.startClean(run.id);
      await refetch();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setStarting(false);
    }
  }

  return (
    <section aria-labelledby="clean-heading" className="space-y-6">
      <div className="flex min-h-8 items-center justify-between">
        <h2 id="clean-heading" className="text-xl">3. Clean</h2>
        {canContinue && (
          <Button
            data-testid="continue-to-done"
            data-primary-action="true"
            onClick={() => navigate(stepHref(run.id, "done", getStepQuery("done")))}
          >
            Continue to Done
          </Button>
        )}
      </div>
      <div className="grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
        <div className="space-y-3">
          <p data-testid="clean-source" className="text-sm text-neutral-700">
            Cleans verification #{verification.id} of brand set &quot;{brandSet}&quot;
            {verification.finished_at ? `, finished ${fmtDateTime(verification.finished_at)}` : ""}. Rows are
            deduplicated, sorted into source buckets with the master media list, and junk is set aside with a reason.
            Nothing is tagged.
          </p>
          <Button
            variant={done ? "outline" : "default"}
            data-primary-action={done ? undefined : "true"}
            disabled={!!run.active_job || starting || !shown}
            onClick={start}
          >
            Start cleaning
          </Button>
          {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        </div>
        <div className="space-y-1.5">
          <Label>Cleaning details for &quot;{brandSet}&quot;</Label>
          {shown ? <DetailsSummary details={shown.details} saved={shown.saved} /> : <p className="text-sm text-neutral-500">Loading...</p>}
          <Link href={`/brands?set=${encodeURIComponent(brandSet)}`} className="block text-sm text-brand-blue hover:underline">
            Edit cleaning details
          </Link>
        </div>
      </div>
      {latest && <CleanJobPanel key={latest.id} run={run} job={latest} refetch={refetch} />}
      {run.clean_jobs.length > 1 && <EarlierCleanings run={run} jobs={run.clean_jobs.slice(1)} />}
    </section>
  );
}

function DetailsSummary({ details, saved }: { details: CleaningDetails; saved: boolean }) {
  return (
    <div data-testid="cleaning-details" className="space-y-2">
      <dl className="grid grid-cols-[minmax(0,180px)_minmax(0,1fr)] gap-x-4 gap-y-1.5 rounded-md border p-3 text-sm">
        {DETAIL_FIELDS.map((f) => (
          <div key={f.key} className="contents">
            <dt className="text-neutral-600">{f.label}</dt>
            <dd className="min-w-0 break-words">
              {details[f.key].length ? details[f.key].join(", ") : <span className="text-neutral-400">None</span>}
            </dd>
          </div>
        ))}
      </dl>
      {!hasOwnDetails(details) && (
        <p className="text-sm text-amber-800">
          No own websites or handles: the brand&apos;s own pages and posts will stay in Clean Data instead of moving to
          Brand Communication.
        </p>
      )}
      {!saved && hasOwnDetails(details) && (
        <p className="text-xs text-neutral-500">Taken from the brand form&apos;s social handles. Not saved yet.</p>
      )}
    </div>
  );
}

function CleanJobPanel({ run, job, refetch }: { run: RunDetail; job: CleanJob; refetch: () => Promise<void> }) {
  const [cancelError, setCancelError] = useState<string | null>(null);
  const active = run.active_job?.kind === "clean" && run.active_job.ref_id === job.id ? run.active_job : null;
  const label = active
    ? active.state === "queued" ? "Waiting for another job to finish" : active.state === "cancelling" ? "Cancelling" : "Cleaning"
    : job.status === "done" ? "Cleaning finished" : job.status === "cancelled" ? "Cleaning cancelled" : job.status === "failed" ? "Cleaning failed" : "Queued";
  const newer = run.verify_jobs.find((v) => v.status === "done");
  const s = job.summary;

  return (
    <div data-testid="clean-job" className="space-y-4 rounded-md border p-4">
      <div className="text-sm text-neutral-700">
        Verification #{job.verify_job_id}, brand set &quot;{job.brand_set}&quot;. Cleaning details copied when this cleaning started.
        {newer && newer.id !== job.verify_job_id && (
          <span className="ml-1 text-amber-800">Verification #{newer.id} has finished since; start cleaning again to use it.</span>
        )}
      </div>
      <div className="flex h-9 items-center justify-between gap-4 text-sm">
        <span data-testid="clean-status" className="font-medium">{label}</span>
        <span className="flex items-center gap-3 text-xs text-neutral-500">
          {job.started_at && (
            <span>
              Elapsed <Elapsed since={job.started_at} until={active ? null : job.finished_at} />
              {job.finished_at && !active ? ` · finished ${fmtDateTime(job.finished_at)}` : ""}
            </span>
          )}
          {active && (
            <Button
              variant="outline"
              size="sm"
              disabled={active.state === "cancelling"}
              onClick={() => {
                setCancelError(null);
                api.cancelJob(active.id).then(refetch).catch((e) => setCancelError(errorMessage(e)));
              }}
            >
              Cancel
            </Button>
          )}
        </span>
      </div>
      {cancelError && <p role="alert" className="text-sm text-red-700">{cancelError}</p>}
      {job.status === "failed" && job.error && <p role="alert" className="text-sm text-red-700">{job.error}</p>}
      {job.status === "done" && (
        <>
          <div data-testid="clean-summary" className="grid gap-6 md:grid-cols-3">
            <Counts
              title="Rows"
              rows={[
                ["Rows in", s.rows_in],
                ["Unique links", s.unique_links],
                ["Duplicates set aside", duplicatesRemoved(s)],
                ["Clean Data", s.clean_data, true],
              ]}
            />
            <Counts title="Clean Data by source bucket" rows={BUCKETS.map((b) => [b, s.buckets?.[b] ?? 0] as const)} />
            <Counts
              title="Out of Clean Data"
              rows={[
                ["Brand Communication", s.brand_communication],
                ["Competitor Owned", s.competitor_owned],
                ...REMOVED_SHEETS.map((name) => [name, s.sheets?.[name] ?? 0] as const),
              ]}
            />
          </div>
          <ul className="space-y-1 text-sm">
            <li>
              {s.new_domains === 1 ? "1 domain is" : `${fmt(s.new_domains)} domains are`} not on the master media list:{" "}
              {s.new_domains === 1 ? "its rows are" : "their rows are"} in Other Media, and the NEW Domains sheet lists them.
            </li>
            {(s.needs_review ?? 0) > 0 && (
              <li>{s.needs_review === 1 ? "1 Clean Data row is" : `${fmt(s.needs_review)} Clean Data rows are`} flagged Needs Review.</li>
            )}
            {s.checks_ok === false && (
              <li className="text-red-700">A data check failed. See Data checks on the Cleaning Summary sheet.</li>
            )}
          </ul>
          <a href={`/api/runs/${run.id}/clean/${job.id}/cleaned.xlsx`} download className={cn(buttonVariants({ variant: "outline" }))}>
            Download cleaned xlsx
          </a>
        </>
      )}
    </div>
  );
}

function Counts({ title, rows }: { title: string; rows: readonly (readonly [string, number | undefined, boolean?])[] }) {
  return (
    <div className="space-y-1.5">
      <p className="text-sm text-neutral-500">{title}</p>
      <dl className="grid grid-cols-[1fr_auto] gap-y-1 text-sm tabular-nums">
        {rows.map(([label, n, strong]) => (
          <div key={label} className="contents">
            <dt className={cn(strong && "font-semibold")}>{label}</dt>
            <dd className={cn("text-right", strong && "font-semibold", !n && "text-neutral-400")}>{fmt(n)}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function EarlierCleanings({ run, jobs }: { run: RunDetail; jobs: CleanJob[] }) {
  return (
    <details className="text-sm">
      <summary className="cursor-pointer text-brand-blue">Earlier cleanings ({jobs.length})</summary>
      <ul className="mt-2 space-y-1">
        {jobs.map((j) => (
          <li key={j.id} className="flex items-center gap-3">
            <span className="w-40 truncate">Verification #{j.verify_job_id}</span>
            <span className="w-24">{j.status}</span>
            <span className="tabular-nums">{fmt(j.summary.clean_data)} clean rows</span>
            {j.has_output && (
              <a className="text-brand-blue hover:underline" href={`/api/runs/${run.id}/clean/${j.id}/cleaned.xlsx`} download>Download</a>
            )}
            {j.status === "failed" && j.error && <span className="text-red-700">{j.error}</span>}
          </li>
        ))}
      </ul>
    </details>
  );
}
