"use client";

import { useEffect, useState } from "react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { BrandTryPanel } from "@/components/BrandTryPanel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { api, errorMessage } from "@/lib/api";
import { type DraftRule, emptyDraft, fromDraft, toDraft } from "@/lib/brandDraft";
import type { BrandSet } from "@/lib/types";

function snapshotOf(n: string, rs: DraftRule[]) {
  return JSON.stringify({ name: n, rules: rs });
}

export function RawSetEditor({
  set,
  existingNames,
  onSaved,
  onDeleted,
  onDirtyChange,
}: {
  set: BrandSet | null;
  existingNames: string[];
  onSaved: (name: string) => void;
  onDeleted: () => void;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const current = set?.name ?? null; // null = new set
  const [name, setName] = useState(set?.name ?? "");
  const [rules, setRules] = useState<DraftRule[]>(() => (set ? set.rules.map(toDraft) : [emptyDraft()]));
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [savedSnapshot, setSavedSnapshot] = useState(() =>
    snapshotOf(set?.name ?? "", set ? set.rules.map(toDraft) : [emptyDraft()]),
  );

  useEffect(() => onDirtyChange(snapshotOf(name, rules) !== savedSnapshot), [name, rules, savedSnapshot, onDirtyChange]);

  const update = (i: number, patch: Partial<DraftRule>) => setRules((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  async function save() {
    setError(null);
    setSaved(null);
    const trimmed = name.trim();
    if (current === null && existingNames.includes(trimmed)) {
      setError(`A set named ${trimmed} already exists - open it to edit.`);
      return;
    }
    try {
      const res = await api.saveBrand(trimmed, rules.map(fromDraft), current === null);
      setSavedSnapshot(snapshotOf(trimmed, rules));
      setSaved(`Saved. The previous config.yaml was backed up to ${res.backup.split("/").pop()}.`);
      onSaved(res.name);
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
      onDeleted();
    } catch (e) {
      setDeleteError(errorMessage(e));
      setDeleting(false);
    }
  }

  return (
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

        <BrandTryPanel run={(text) => api.testBrand({ text, rules: rules.map(fromDraft) })} />

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
    </section>
  );
}
