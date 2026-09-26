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
import { api, errorMessage } from "@/lib/api";
import { PROVIDER_LABEL, VERTICAL_LABEL, fmt } from "@/lib/format";
import type { Options, Provider, SearchInput, Vertical } from "@/lib/types";
import { usePlan } from "@/lib/usePlan";

const FALLBACK: Options = { providers: ["serpapi", "dataforseo"], verticals: ["web", "news", "news_tab"], max_pages: { serpapi: 50, dataforseo: 20 } };

export function SearchForm() {
  const router = useRouter();
  const [options, setOptions] = useState<Options>(FALLBACK);
  const [form, setForm] = useState<SearchInput>({ queries: "", provider: "serpapi", vertical: "web", pages: "1", start: "", end: "" });
  const { plan, error, loading } = usePlan(form);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    api.options().then(setOptions).catch(() => undefined); // the banner reports a down backend
  }, []);

  const set = <K extends keyof SearchInput>(key: K, value: SearchInput[K]) => setForm((f) => ({ ...f, [key]: value }));
  const canRun = !!plan && !error && !loading && !submitting;

  async function submit() {
    if (!plan) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const { id } = await api.createRun({ ...form, confirmed_calls: plan.max_calls });
      router.push(`/runs/${id}`);
    } catch (e) {
      setSubmitError(errorMessage(e));
      setSubmitting(false);
      setConfirmOpen(false);
    }
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_360px]">
      <section className="space-y-6">
        <Field id="queries" label="Queries" hint="One query per line. Boolean operators and quotes are fine. A comma also splits queries, so check the parsed list.">
          <Textarea id="queries" rows={14} value={form.queries} onChange={(e) => set("queries", e.target.value)} className="font-mono text-sm" />
        </Field>
        <div className="grid grid-cols-2 gap-4 xl:grid-cols-5">
          <Field id="provider" label="Engine">
            <NativeSelect id="provider" value={form.provider} onChange={(e) => set("provider", e.target.value as Provider)}>
              {options.providers.map((p) => (
                <option key={p} value={p}>{PROVIDER_LABEL[p]}</option>
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
          <Field id="pages" label="Pages per query" hint={`Up to ${options.max_pages[form.provider]} on ${PROVIDER_LABEL[form.provider]}`}>
            <Input id="pages" type="number" min={1} max={options.max_pages[form.provider]} value={form.pages} onChange={(e) => set("pages", e.target.value)} />
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
        <Button className="w-full" disabled={!canRun} onClick={() => setConfirmOpen(true)}>Run search</Button>
        {submitError && <p role="alert" className="text-sm text-red-700">{submitError}</p>}
      </aside>
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Start this search?</AlertDialogTitle>
            <AlertDialogDescription>
              This can make up to {fmt(plan?.max_calls)} billable SERP page requests on {PROVIDER_LABEL[form.provider]} ({fmt(plan?.cached_calls)} already cached and free). Queries stop early when results run out, so the real number is usually lower.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
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
