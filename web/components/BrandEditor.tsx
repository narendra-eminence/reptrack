"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { api, errorMessage } from "@/lib/api";
import { type DraftRule, emptyDraft, fromDraft, toDraft } from "@/lib/brandDraft";
import type { BrandSet, TryResult } from "@/lib/types";
import { cn } from "@/lib/utils";

export function BrandEditor() {
  const [sets, setSets] = useState<BrandSet[]>([]);
  const [current, setCurrent] = useState<string | null>(null); // null = new set
  const [name, setName] = useState("");
  const [rules, setRules] = useState<DraftRule[]>([emptyDraft()]);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [sample, setSample] = useState("");
  const [tried, setTried] = useState<TryResult | null>(null);
  const [tryError, setTryError] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [savedSnapshot, setSavedSnapshot] = useState(() => JSON.stringify({ name: "", rules: [emptyDraft()] }));

  const load = useCallback(async () => {
    try {
      setSets((await api.brands()).sets);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);

  useEffect(() => {
    let alive = true;
    api
      .brands()
      .then((r) => {
        if (alive) setSets(r.sets);
      })
      .catch((e) => {
        if (alive) setError(errorMessage(e));
      });
    return () => {
      alive = false;
    };
  }, []);

  function snapshotOf(n: string, rs: DraftRule[]) {
    return JSON.stringify({ name: n, rules: rs });
  }

  function isDirty() {
    return snapshotOf(name, rules) !== savedSnapshot;
  }

  function openNow(set: BrandSet | null) {
    setCurrent(set?.name ?? null);
    const n = set?.name ?? "";
    const rs = set ? set.rules.map(toDraft) : [emptyDraft()];
    setName(n);
    setRules(rs);
    setSavedSnapshot(snapshotOf(n, rs));
    setError(null);
    setSaved(null);
    setTried(null);
    setTryError(null);
  }

  function open(set: BrandSet | null) {
    if (isDirty() && !window.confirm("Discard unsaved changes?")) return;
    openNow(set);
  }

  const update = (i: number, patch: Partial<DraftRule>) => setRules((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  async function save() {
    setError(null);
    setSaved(null);
    const trimmed = name.trim();
    if (current === null && sets.some((s) => s.name === trimmed)) {
      setError(`A set named ${trimmed} already exists - open it to edit.`);
      return;
    }
    try {
      const res = await api.saveBrand(trimmed, rules.map(fromDraft), current === null);
      await load();
      setCurrent(res.name);
      setSavedSnapshot(snapshotOf(trimmed, rules));
      setSaved(`Saved. The previous config.yaml was backed up to ${res.backup.split("/").pop()}.`);
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  async function remove() {
    if (!current) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await api.deleteBrand(current);
      setDeleteOpen(false);
      setDeleting(false);
      await load();
      openNow(null);
    } catch (e) {
      setDeleteError(errorMessage(e));
      setDeleting(false);
    }
  }

  async function tryRules() {
    setTryError(null);
    try {
      setTried(await api.testBrand({ text: sample, rules: rules.map(fromDraft) }));
    } catch (e) {
      setTried(null);
      setTryError(errorMessage(e));
    }
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[240px_minmax(0,1fr)]">
      <aside className="space-y-2">
        <Button variant="outline" className="w-full" onClick={() => open(null)}>New set</Button>
        <ul className="space-y-1">
          {sets.map((s) => (
            <li key={s.name}>
              <button
                type="button"
                onClick={() => open(s)}
                className={cn(
                  "w-full truncate rounded-md px-3 py-2 text-left text-sm",
                  current === s.name ? "bg-brand-navy text-white" : "hover:bg-neutral-100",
                )}
              >
                {s.name}
              </button>
            </li>
          ))}
        </ul>
      </aside>
      <section className="space-y-6">
        <div className="max-w-sm space-y-1.5">
          <Label htmlFor="set-name">Set name</Label>
          <Input
            id="set-name"
            value={name}
            disabled={current !== null}
            onChange={(e) => setName(e.target.value)}
            placeholder="lowercase, e.g. safari"
          />
        </div>
        <ol className="space-y-4">
          {rules.map((r, i) => (
            <li key={i} className="space-y-3 rounded-md border p-4">
              <div className="flex items-center justify-between">
                <h3 className="text-base">Rule {i + 1}</h3>
                {rules.length > 1 && (
                  <Button variant="ghost" size="sm" onClick={() => setRules((rs) => rs.filter((_, j) => j !== i))}>
                    Remove rule
                  </Button>
                )}
              </div>
              <div className="grid gap-3 md:grid-cols-[1fr_2fr]">
                <div className="space-y-1.5">
                  <Label>Name</Label>
                  <Input aria-label={`Rule ${i + 1} name`} value={r.name} onChange={(e) => update(i, { name: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label>Pattern (regular expression)</Label>
                  <Input
                    aria-label={`Rule ${i + 1} pattern`}
                    value={r.pattern}
                    onChange={(e) => update(i, { pattern: e.target.value })}
                    className="font-mono"
                  />
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-6">
                <label className="flex h-8 items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    aria-label={`Rule ${i + 1} case sensitive`}
                    className="size-4 accent-[#000c66]"
                    checked={r.case_sensitive}
                    onChange={(e) => update(i, { case_sensitive: e.target.checked })}
                  />
                  Case sensitive
                </label>
                <label className="flex h-8 items-center gap-2 text-sm">
                  Context window
                  <Input
                    aria-label={`Rule ${i + 1} context window`}
                    type="number"
                    min={1}
                    value={r.context_window}
                    onChange={(e) => update(i, { context_window: e.target.value })}
                    className="w-24"
                  />
                  characters
                </label>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Context words (one regex per line; a hit counts only if one is nearby)</Label>
                  <Textarea
                    aria-label={`Rule ${i + 1} context words`}
                    value={r.require_context}
                    onChange={(e) => update(i, { require_context: e.target.value })}
                    className="field-sizing-fixed h-24 resize-y font-mono text-xs"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Exclusions (one regex per line; matches inside these never count)</Label>
                  <Textarea
                    aria-label={`Rule ${i + 1} exclusions`}
                    value={r.exclude}
                    onChange={(e) => update(i, { exclude: e.target.value })}
                    className="field-sizing-fixed h-24 resize-y font-mono text-xs"
                  />
                </div>
              </div>
            </li>
          ))}
        </ol>
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="outline" onClick={() => setRules((rs) => [...rs, emptyDraft()])}>Add rule</Button>
          <Button onClick={save} disabled={!name.trim()}>Save set</Button>
          {current && (
            <Button
              variant="outline"
              onClick={() => {
                setDeleteError(null);
                setDeleteOpen(true);
              }}
            >
              Delete set
            </Button>
          )}
        </div>
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        {saved && <p role="status" className="text-sm text-green-800">{saved}</p>}

        <div className="space-y-3 rounded-md border p-4">
          <h3 className="text-base">Try these rules</h3>
          <div className="space-y-1.5">
            <Label htmlFor="sample">Sample text</Label>
            <Textarea
              id="sample"
              value={sample}
              onChange={(e) => setSample(e.target.value)}
              placeholder="Paste a sentence or paragraph from a real page."
              className="field-sizing-fixed h-32 resize-y"
            />
          </div>
          <Button variant="outline" disabled={!sample.trim()} onClick={tryRules}>Try rules</Button>
          {tryError && <p role="alert" className="text-sm text-red-700">{tryError}</p>}
          {tried && (
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <p className="text-sm font-semibold">Counted ({tried.hits.length})</p>
                <ul data-testid="try-hits" className="mt-1 space-y-1 text-sm">
                  {tried.hits.map((h) => (
                    <li key={`${h.brand}-${h.offset}`}>
                      <span className="font-medium">{h.brand}</span>: {h.snippet}
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="text-sm font-semibold">Not counted ({tried.excluded.length})</p>
                <ul data-testid="try-excluded" className="mt-1 space-y-1 text-sm">
                  {tried.excluded.map((x) => (
                    <li key={`${x.brand}-${x.offset}`}>&quot;{x.text}&quot; - {x.reason}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </div>
      </section>

      <AlertDialog
        open={deleteOpen}
        onOpenChange={(o) => {
          if (!deleting) {
            setDeleteOpen(o);
            if (!o) setDeleteError(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete brand set &quot;{current}&quot;?</AlertDialogTitle>
            <AlertDialogDescription>
              It is removed from config.yaml (a backup is kept). Finished verifications keep the copy of the rules they used.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {deleteError && <p role="alert" className="text-sm text-red-700">{deleteError}</p>}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleting}
              onClick={(e) => {
                e.preventDefault();
                void remove();
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
