"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Field } from "@/components/Field";
import { NativeSelect } from "@/components/NativeSelect";
import { PlanPreview } from "@/components/PlanPreview";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ApiError, api, errorMessage } from "@/lib/api";
import { PROVIDER_LABEL, VERTICAL_LABEL, fmt, regionLabel } from "@/lib/format";
import type { Options, Provider, Region, SearchInput, Vertical } from "@/lib/types";
import { usePlan } from "@/lib/usePlan";

const FALLBACK: Options = {
  providers: ["serpapi", "dataforseo"],
  verticals: ["web", "news", "news_tab"],
  max_pages: { serpapi: 50, dataforseo: 20 },
  regions: [{ id: "in", label: "India" }, { id: "us", label: "United States" }],
};

export function SearchForm() {
  const router = useRouter();
  const [options, setOptions] = useState<Options>(FALLBACK);
  const [form, setForm] = useState<SearchInput>({ queries: "", provider: "serpapi", region: "in", vertical: "web", pages: "1", start: "", end: "" });
  const { plan, error, loading, stale } = usePlan(form);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  // Overrides plan.max_calls once the server has reported a changed ceiling (409 with max_calls) for this
  // in-flight confirmation; null means "use the plan's own figure".
  const [confirmCalls, setConfirmCalls] = useState<number | null>(null);

  useEffect(() => {
    api.options().then(setOptions).catch(() => undefined); // the banner reports a down backend
  }, []);

  const set = <K extends keyof SearchInput>(key: K, value: SearchInput[K]) => setForm((f) => ({ ...f, [key]: value }));
  const canRun = !!plan && !error && !loading && !stale && !submitting;
  const isNews = form.vertical === "news"; // news cannot paginate; the API always pins it to 1 (bulk_search.pages_for)
  const confirmedCalls = confirmCalls ?? plan?.max_calls;

  async function submit() {
    if (!plan) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const { id } = await api.createRun({ ...form, confirmed_calls: confirmedCalls ?? plan.max_calls });
      // Always land on Search right after creating a run, even if the fixture backend is fast enough that
      // results already exist by the time this resolves - the /runs/[id] redirect is for returning to an
      // existing run, not for a run just created (see workflow-routes-brief.md).
      router.push(`/runs/${id}/search`);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409 && e.body && typeof e.body === "object" && "max_calls" in e.body) {
        // The billable ceiling changed (e.g. more of the query set is now cached) since this dialog opened; show
        // the server's own message (it already names the new figure) and let the user confirm it instead.
        setConfirmCalls((e.body as { max_calls: number }).max_calls);
      }
      setSubmitError(errorMessage(e));
      setSubmitting(false);
    }
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_360px]">
      <section className="space-y-6">
        <Field id="queries" label="Queries" hint="One query per line. Boolean operators and quotes are fine. A comma also splits queries, so check the parsed list.">
          <Textarea
            id="queries"
            rows={14}
            value={form.queries}
            onChange={(e) => set("queries", e.target.value)}
            className="field-sizing-fixed h-80 resize-y font-mono text-sm"
          />
        </Field>
        <div className="grid grid-cols-2 gap-4 xl:grid-cols-3">
          <Field id="provider" label="Engine">
            <NativeSelect id="provider" value={form.provider} onChange={(e) => set("provider", e.target.value as Provider)}>
              {options.providers.map((p) => (
                <option key={p} value={p}>{PROVIDER_LABEL[p]}</option>
              ))}
            </NativeSelect>
          </Field>
          <Field id="region" label="Region">
            <NativeSelect id="region" value={form.region} onChange={(e) => set("region", e.target.value as Region)}>
              {options.regions.map((r) => (
                <option key={r.id} value={r.id}>{r.label}</option>
              ))}
            </NativeSelect>
          </Field>
          <Field id="vertical" label="Vertical">
            <NativeSelect id="vertical" value={form.vertical} onChange={(e) => set("vertical", e.target.value as Vertical)}>
              {options.verticals.map((v) => (
                <option key={v} value={v}>{VERTICAL_LABEL[v]}</option>
              ))}
            </NativeSelect>
          </Field>
          <Field
            id="pages"
            label="Pages per query"
            hint={isNews ? "News returns all results in one call" : `Up to ${options.max_pages[form.provider]} on ${PROVIDER_LABEL[form.provider]}`}
          >
            <Input
              id="pages"
              type="number"
              min={1}
              max={options.max_pages[form.provider]}
              value={isNews ? "1" : form.pages}
              disabled={isNews}
              onChange={(e) => set("pages", e.target.value)}
            />
          </Field>
          <Field id="start" label="Start date">
            <Input id="start" type="date" value={form.start} onChange={(e) => set("start", e.target.value)} />
          </Field>
          <Field id="end" label="End date">
            <Input id="end" type="date" value={form.end} onChange={(e) => set("end", e.target.value)} />
          </Field>
        </div>
      </section>
      <aside className="space-y-4">
        <PlanPreview plan={plan} error={error} loading={loading} provider={form.provider} />
        <Button className="w-full" disabled={!canRun} onClick={() => { setSubmitError(null); setConfirmCalls(null); setConfirmOpen(true); }}>Run search</Button>
      </aside>
      <AlertDialog open={confirmOpen} onOpenChange={(open) => { if (!submitting) setConfirmOpen(open); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Start this search?</AlertDialogTitle>
            <AlertDialogDescription>
              This can make up to {fmt(confirmedCalls)} billable SERP page requests on {PROVIDER_LABEL[form.provider]}, searching from {regionLabel(form.region)} ({fmt(plan?.cached_calls)} already cached and free). Queries stop early when results run out, so the real number is usually lower.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {submitError && <p role="alert" className="text-sm text-red-700">{submitError}</p>}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={submitting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={submitting}
              onClick={(e) => {
                e.preventDefault();
                void submit();
              }}
            >
              Confirm and run
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
