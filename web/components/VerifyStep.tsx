"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { BrandSummary } from "@/components/BrandSummary";
import { Elapsed } from "@/components/Elapsed";
import { Field } from "@/components/Field";
import { NativeSelect } from "@/components/NativeSelect";
import { StatusChips } from "@/components/StatusChips";
import { VerifyResultsTable } from "@/components/VerifyResultsTable";
import { Button, buttonVariants } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { api, errorMessage } from "@/lib/api";
import { fmt, fmtDateTime } from "@/lib/format";
import { useRunContext } from "@/lib/RunContext";
import { doneAvailable, stepHref } from "@/lib/steps";
import { useStepNavigation } from "@/lib/useStepNavigation";
import { cn } from "@/lib/utils";
import type { BrandSet, RunDetail, VerifyJob } from "@/lib/types";

export function VerifyStep({ run, refetch }: { run: RunDetail; refetch: () => Promise<void> }) {
  const [sets, setSets] = useState<BrandSet[] | null>(null);
  const [selected, setSelected] = useState("");
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useStepNavigation();
  const { getStepQuery } = useRunContext();

  useEffect(() => {
    api.brands().then((r) => setSets(r.sets)).catch((e) => setError(errorMessage(e)));
  }, []);

  const selectedSet = sets?.find((s) => s.name === selected);
  const latest = run.verify_jobs[0];
  const pending = run.counts.pending;
  // Controller ruling: Start verification stays the red primary action (disabled while any job is active) until
  // a verification has actually finished; only then does Continue to Done take over as the one red button.
  const done = doneAvailable(run);
  const canContinueToDone = done && !run.active_job;

  async function start() {
    setStarting(true);
    setError(null);
    try {
      await api.startVerify(run.id, selected);
      await refetch();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setStarting(false);
    }
  }

  return (
    <section aria-labelledby="verify-heading" className="space-y-6">
      <div className="flex min-h-8 items-center justify-between">
        <h2 id="verify-heading" className="text-xl">2. Verify</h2>
        {canContinueToDone && (
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
          <Field id="brand-set" label="Brand set" hint="Every URL is checked against exactly this brand set. It is copied when verification starts.">
            <NativeSelect id="brand-set" value={selected} onChange={(e) => setSelected(e.target.value)}>
              <option value="">Choose a brand set</option>
              {sets?.map((s) => (
                <option key={s.name} value={s.name}>{s.name}</option>
              ))}
            </NativeSelect>
          </Field>
          <Link href="/brands" className="block text-sm text-brand-blue hover:underline">Edit brands</Link>
          <Button
            variant={done ? "outline" : "default"}
            data-primary-action={done ? undefined : "true"}
            disabled={!selected || !!run.active_job || starting}
            onClick={start}
          >
            Start verification
          </Button>
          {pending > 0 && (
            <p className="text-sm text-amber-800">
              {pending} {pending === 1 ? "query" : "queries"} unfinished; verifying the results collected so far.
            </p>
          )}
          {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        </div>
        <div className="space-y-1.5">
          <Label>Brands that will be matched</Label>
          {selectedSet ? (
            <BrandSummary set={selectedSet} />
          ) : (
            <p className="text-sm text-neutral-500">Pick a brand set to see exactly what will be matched.</p>
          )}
        </div>
      </div>
      {latest && <VerifyJobPanel key={latest.id} run={run} job={latest} liveSets={sets} refetch={refetch} />}
      {run.verify_jobs.length > 1 && <EarlierVerifications run={run} jobs={run.verify_jobs.slice(1)} />}
    </section>
  );
}

function VerifyJobPanel({ run, job, liveSets, refetch }: { run: RunDetail; job: VerifyJob; liveSets: BrandSet[] | null; refetch: () => Promise<void> }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const status = searchParams.get("status") ?? "";
  const dupsParam = searchParams.get("dups");
  // A selected status chip hides duplicates by default, unless the viewer explicitly chose to show them.
  const hideDuplicates = dupsParam === "hide" ? true : dupsParam === "show" ? false : !!status;
  const [cancelError, setCancelError] = useState<string | null>(null);

  function setStatus(next: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (next) params.set("status", next);
    else params.delete("status");
    params.delete("dups");
    params.delete("q");
    params.delete("page");
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  function setHideDuplicates(v: boolean) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("dups", v ? "hide" : "show");
    params.delete("page");
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }
  const active = run.active_job?.kind === "verify" && run.active_job.ref_id === job.id ? run.active_job : null;
  const live = liveSets?.find((s) => s.name === job.brand_set);
  const changed = liveSets !== null && JSON.stringify(live?.rules ?? null) !== JSON.stringify(job.brand_rules);
  const label = active
    ? active.state === "queued" ? "Waiting for another job to finish" : active.state === "cancelling" ? "Cancelling" : "Verifying"
    : job.status === "done" ? "Verification finished" : job.status === "cancelled" ? "Verification cancelled" : job.status === "failed" ? "Verification failed" : "Queued";

  return (
    <div className="space-y-4 rounded-md border p-4">
      <div data-testid="snapshot-note" className="text-sm text-neutral-700">
        Brand set &quot;{job.brand_set}&quot;, brand set copied when this verification started.
        {changed && <span className="ml-1 text-amber-800">The live set has changed or been deleted since; these results use the copy.</span>}
      </div>
      <div data-testid="verify-progress" className="space-y-3">
        <div className="flex items-baseline justify-between gap-4 text-sm tabular-nums">
          <span className="font-medium">{label}</span>
          <span>{fmt(job.done_urls)} of {job.total_urls === null ? "..." : fmt(job.total_urls)} URLs</span>
        </div>
        <Progress value={job.total_urls ? (job.done_urls / job.total_urls) * 100 : 0} />
        <div className="flex h-9 items-center justify-between text-xs text-neutral-500">
          <span>
            {job.started_at ? <>Elapsed <Elapsed since={job.started_at} until={active ? null : job.finished_at} /></> : ""}
            {job.finished_at && !active ? ` · finished ${fmtDateTime(job.finished_at)}` : ""}
          </span>
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
        </div>
        {cancelError && <p role="alert" className="text-sm text-red-700">{cancelError}</p>}
      </div>
      {job.status === "failed" && job.error && <p role="alert" className="text-sm text-red-700">{job.error}</p>}
      <div className="space-y-1.5">
        <p className="text-sm text-neutral-500">Unique URLs by status</p>
        <StatusChips counts={job.status_counts} selected={job.status === "done" ? status : undefined} onSelect={job.status === "done" ? setStatus : undefined} />
      </div>
      {job.status === "done" && (
        <VerifyResultsTable
          key={status}
          runId={run.id}
          verifyJobId={job.id}
          status={status}
          hideDuplicates={hideDuplicates}
          onHideDuplicatesChange={setHideDuplicates}
          actions={
            <a href={`/api/runs/${run.id}/verify/${job.id}/verified.xlsx`} download className={cn(buttonVariants({ variant: "outline" }))}>
              Download verified xlsx
            </a>
          }
        />
      )}
    </div>
  );
}

function EarlierVerifications({ run, jobs }: { run: RunDetail; jobs: VerifyJob[] }) {
  return (
    <details className="text-sm">
      <summary className="cursor-pointer text-brand-blue">Earlier verifications ({jobs.length})</summary>
      <ul className="mt-2 space-y-1">
        {jobs.map((j) => (
          <li key={j.id} className="flex items-center gap-3">
            <span className="w-40 truncate">{j.brand_set}</span>
            <span className="w-24">{j.status}</span>
            <span className="tabular-nums">{fmt(j.status_counts["Verified"] ?? 0)} verified</span>
            {j.has_output && (
              <a className="text-brand-blue hover:underline" href={`/api/runs/${run.id}/verify/${j.id}/verified.xlsx`} download>Download</a>
            )}
            {j.status === "failed" && j.error && <span className="text-red-700">{j.error}</span>}
          </li>
        ))}
      </ul>
    </details>
  );
}
