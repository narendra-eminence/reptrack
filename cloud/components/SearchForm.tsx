"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
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
import { fmt, regionLabel } from "@/lib/format";
import { MAX_PAGES, REGIONS, VERTICALS, VERTICAL_LABEL, type Region, type Vertical } from "@/lib/serp/core";
import type { SearchInput } from "@/lib/types";
import { usePlan } from "@/lib/usePlan";

export function SearchForm() {
  const router = useRouter();
  const [form, setForm] = useState<SearchInput>({ queries: "", region: "in", vertical: "web", pages: "1", start: "", end: "" });
  const { plan, error, loading, stale } = usePlan(form);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  // The server's ceiling when it differs from the plan (409 with max_calls); null means use the plan's figure.
  const [confirmCalls, setConfirmCalls] = useState<number | null>(null);

  const set = <K extends keyof SearchInput>(key: K, value: SearchInput[K]) => setForm((f) => ({ ...f, [key]: value }));
  const canRun = !!plan && !error && !loading && !stale && !submitting;
  const isNews = form.vertical === "news"; // google_news has no second page
  const confirmedCalls = confirmCalls ?? plan?.max_calls;

  async function submit() {
    if (!plan) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const { id } = await api.createRun({ ...form, confirmed_calls: confirmedCalls ?? plan.max_calls });
      router.push(`/runs/${id}`);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409 && e.body && typeof e.body === "object" && "max_calls" in e.body) {
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
          <Field id="region" label="Region">
            <NativeSelect id="region" value={form.region} onChange={(e) => set("region", e.target.value as Region)}>
              {(Object.keys(REGIONS) as Region[]).map((r) => (
                <option key={r} value={r}>{REGIONS[r].label}</option>
              ))}
            </NativeSelect>
          </Field>
          <Field id="vertical" label="Vertical">
            <NativeSelect id="vertical" value={form.vertical} onChange={(e) => set("vertical", e.target.value as Vertical)}>
              {VERTICALS.map((v) => (
                <option key={v} value={v}>{VERTICAL_LABEL[v]}</option>
              ))}
            </NativeSelect>
          </Field>
          <Field id="pages" label="Pages per query" hint={isNews ? "News returns all results in one call" : `Up to ${MAX_PAGES}`}>
            <Input id="pages" type="number" min={1} max={MAX_PAGES} value={isNews ? "1" : form.pages} disabled={isNews} onChange={(e) => set("pages", e.target.value)} />
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
        <PlanPreview plan={plan} error={error} loading={loading} />
        <Button className="w-full" disabled={!canRun} onClick={() => { setSubmitError(null); setConfirmCalls(null); setConfirmOpen(true); }}>Run search</Button>
      </aside>
      <AlertDialog open={confirmOpen} onOpenChange={(open) => { if (!submitting) setConfirmOpen(open); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Start this search?</AlertDialogTitle>
            <AlertDialogDescription>
              This can make up to {fmt(confirmedCalls)} billable SerpAPI page requests, searching from {regionLabel(form.region)} ({fmt(plan?.cached_calls)} already cached and free). Queries stop early when results run out, so the real number is usually lower.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {submitError && <p role="alert" className="text-sm text-red-700">{submitError}</p>}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={submitting}>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={submitting} onClick={(e) => { e.preventDefault(); void submit(); }}>Confirm and run</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
