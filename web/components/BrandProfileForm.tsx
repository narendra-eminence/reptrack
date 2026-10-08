"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { BrandRules } from "@/components/BrandRules";
import { BrandTryPanel } from "@/components/BrandTryPanel";
import { NativeSelect } from "@/components/NativeSelect";
import { TagInput } from "@/components/TagInput";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, errorMessage } from "@/lib/api";
import { CLOSENESS_LABELS, cleanProfile, emptyBrand, emptyWord } from "@/lib/brandProfile";
import type { BrandProfile, BrandRule, Closeness, EverydayWord, ProfileBrand, ProfileWarning } from "@/lib/types";

type Props = {
  name: string | null; // null = new set
  initial: BrandProfile;
  stale: boolean;
  existingNames: string[];
  suggestAvailable: boolean;
  onSaved: (name: string, profile: BrandProfile) => void;
  onDeleted: () => void;
  onDetached: (name: string) => void;
  onDirtyChange: (dirty: boolean) => void;
};

export function BrandProfileForm({ name, initial, stale, existingNames, onSaved, onDeleted, onDetached, onDirtyChange }: Props) {
  const [savedName, setSavedName] = useState(name); // becomes the set's name after a new set is saved, so the form stays mounted
  const [setName, setSetName] = useState(name ?? "");
  const [profile, setProfile] = useState<BrandProfile>(initial);
  const [savedSnapshot, setSavedSnapshot] = useState(() => JSON.stringify({ n: name ?? "", p: initial }));
  const [warnings, setWarnings] = useState<ProfileWarning[]>([]);
  const [rules, setRules] = useState<BrandRule[]>([]);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [showRules, setShowRules] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [dialog, setDialog] = useState<"delete" | "detach" | null>(null);
  const [busy, setBusy] = useState(false);

  const snapshot = JSON.stringify({ n: setName, p: profile });
  useEffect(() => onDirtyChange(snapshot !== savedSnapshot), [snapshot, savedSnapshot, onDirtyChange]);

  // Preview on every change (debounced): warnings next to fields, and the generated rules.
  const clean = useMemo(() => cleanProfile(profile), [profile]);
  useEffect(() => {
    const t = setTimeout(() => {
      api
        .previewBrandProfile(clean)
        .then((r) => {
          setWarnings(r.warnings);
          setRules(r.rules);
          setPreviewError(null);
        })
        .catch((e) => {
          setWarnings([]);
          setRules([]);
          setPreviewError(errorMessage(e));
        });
    }, 400);
    return () => clearTimeout(t);
  }, [clean]);

  const updateBrand = (i: number, patch: Partial<ProfileBrand>) =>
    setProfile((p) => ({ ...p, brands: p.brands.map((b, j) => (j === i ? { ...b, ...patch } : b)) }));
  const updateWord = (i: number, patch: Partial<EverydayWord>) =>
    setProfile((p) => ({
      ...p,
      brands: p.brands.map((b, j) => (j === i && b.everyday_word ? { ...b, everyday_word: { ...b.everyday_word, ...patch } } : b)),
    }));
  const warningsFor = (i: number | null, field: string) =>
    warnings.filter((w) => w.brand === i && w.field === field).map((w) => (
      <p key={w.message} className="text-xs text-amber-800">{w.message}</p>
    ));

  async function save() {
    setError(null);
    setSaved(null);
    const n = setName.trim();
    if (savedName === null && existingNames.includes(n)) {
      setError(`A set named ${n} already exists - pick another name.`);
      return;
    }
    try {
      const res = await api.saveBrandProfile(n, clean, savedName === null);
      setSavedSnapshot(JSON.stringify({ n: setName, p: profile }));
      setSaved(`Saved. The previous config.yaml was backed up to ${res.backup.split("/").pop()}.`);
      setSavedName(res.name);
      onSaved(res.name, clean);
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  async function confirmDialog() {
    if (!savedName || !dialog) return;
    setBusy(true);
    try {
      if (dialog === "delete") {
        await api.deleteBrand(savedName);
        onDeleted();
      } else {
        await api.detachBrandProfile(savedName);
        onDetached(savedName);
      }
      setDialog(null);
    } catch (e) {
      setError(errorMessage(e));
      setDialog(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-6">
      {stale && (
        <p role="note" className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          These rules differ from what the form would produce, probably from a hand edit of config.yaml. Saving will replace them with the form&apos;s version.
        </p>
      )}
      <div className="max-w-sm space-y-1.5">
        <Label htmlFor="set-name">Set name</Label>
        <Input className="h-9" id="set-name" value={setName} disabled={savedName !== null} onChange={(e) => setSetName(e.target.value)} placeholder="lowercase, e.g. safari" />
      </div>

      <ol className="space-y-4">
        {profile.brands.map((b, i) => {
          const n = i + 1;
          const w = b.everyday_word;
          return (
            <li key={i} className="space-y-4 rounded-md border p-4">
              <div className="flex items-center justify-between">
                <h3 className="text-base">{i === 0 ? "Brand" : `Brand ${n}`}</h3>
                {profile.brands.length > 1 && (
                  <Button variant="ghost" size="sm" onClick={() => setProfile((p) => ({ ...p, brands: p.brands.filter((_, j) => j !== i) }))}>
                    Remove brand
                  </Button>
                )}
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor={`b${i}-name`}>Brand name</Label>
                  <Input className="h-9" id={`b${i}-name`} aria-label={`Brand ${n} name`} value={b.name} onChange={(e) => updateBrand(i, { name: e.target.value })} placeholder="e.g. Safari" />
                </div>
                <TagInput
                  id={`b${i}-handles`}
                  label="Extra hashtags or handles"
                  ariaLabel={`Brand ${n} hashtags or handles`}
                  values={b.handles}
                  onChange={(v) => updateBrand(i, { handles: v })}
                  placeholder="e.g. safaribags"
                  hint="Without # or @. Hashtags of the names below are added automatically."
                />
              </div>
              <TagInput
                id={`b${i}-always`}
                label="Names that always mean this brand"
                ariaLabel={`Brand ${n} names that always mean this brand`}
                values={b.always}
                onChange={(v) => updateBrand(i, { always: v })}
                placeholder="Full name, ticker, other scripts - press Enter after each"
              />
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  aria-label={`Brand ${n} short name is also an everyday word`}
                  className="size-4 accent-[#000c66]"
                  checked={w !== null}
                  onChange={(e) => updateBrand(i, { everyday_word: e.target.checked ? emptyWord(b.name.trim()) : null })}
                />
                Is the short name also an everyday word? (like Safari, VIP, Basil)
              </label>
              {w && (
                <div className="space-y-4 border-l-2 border-neutral-200 pl-4">
                  <div className="flex flex-wrap items-end gap-6">
                    <div className="w-56 space-y-1.5">
                      <Label htmlFor={`b${i}-word`}>The everyday word</Label>
                      <Input className="h-9" id={`b${i}-word`} aria-label={`Brand ${n} everyday word`} value={w.word} onChange={(e) => updateWord(i, { word: e.target.value })} />
                    </div>
                    <label className="flex h-9 items-center gap-2 text-sm">
                      <input type="checkbox" aria-label={`Brand ${n} match exact capitals`} className="size-4 accent-[#000c66]" checked={w.exact_case} onChange={(e) => updateWord(i, { exact_case: e.target.checked })} />
                      Match exact capitals
                    </label>
                    <div className="w-64 space-y-1.5">
                      <Label htmlFor={`b${i}-close`}>How close confirming words must be</Label>
                      <NativeSelect className="h-9" id={`b${i}-close`} aria-label={`Brand ${n} how close`} value={w.closeness} onChange={(e) => updateWord(i, { closeness: e.target.value as Closeness })}>
                        {(Object.keys(CLOSENESS_LABELS) as Closeness[]).map((c) => (
                          <option key={c} value={c}>{CLOSENESS_LABELS[c]}</option>
                        ))}
                      </NativeSelect>
                    </div>
                  </div>
                  <TagInput id={`b${i}-confirm`} label="Words that confirm it's the brand" ariaLabel={`Brand ${n} confirming words`} values={w.confirm} onChange={(v) => updateWord(i, { confirm: v })} placeholder="e.g. luggage, bag, NSE" hint="Plurals are matched automatically. Brand names and people in this set also count.">
                    {warningsFor(i, "confirm")}
                  </TagInput>
                  <div className="grid gap-4 md:grid-cols-2">
                    <TagInput id={`b${i}-after`} label="Not the brand when followed by" ariaLabel={`Brand ${n} not followed by`} values={w.not_followed_by} onChange={(v) => updateWord(i, { not_followed_by: v })} placeholder="e.g. browser, tour" />
                    <TagInput id={`b${i}-before`} label="Not the brand when preceded by" ariaLabel={`Brand ${n} not preceded by`} values={w.not_preceded_by} onChange={(v) => updateWord(i, { not_preceded_by: v })} placeholder="e.g. Apple, jeep" />
                    <TagInput id={`b${i}-sentence`} label="Not the brand in the same sentence as" ariaLabel={`Brand ${n} not in the same sentence as`} values={w.not_in_sentence_with} onChange={(v) => updateWord(i, { not_in_sentence_with: v })} placeholder="e.g. Serengeti, Kruger" />
                    <TagInput id={`b${i}-phrases`} label="Exact phrases to ignore" ariaLabel={`Brand ${n} phrases to ignore`} values={w.ignore_phrases} onChange={(v) => updateWord(i, { ignore_phrases: v })} placeholder="e.g. Ritz-Carlton">
                      {warningsFor(i, "ignore_phrases")}
                    </TagInput>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ol>
      <Button variant="outline" onClick={() => setProfile((p) => ({ ...p, brands: [...p.brands, emptyBrand()] }))}>Add brand</Button>

      <div className="space-y-3 rounded-md border p-4">
        <h3 className="text-base">People</h3>
        <p className="text-sm text-neutral-600">Founders and leaders. Their names count as mentions of the brand.</p>
        {profile.people.map((x, i) => (
          <div key={i} className="flex flex-wrap items-center gap-4">
            <Input
              aria-label={`Person ${i + 1} name`}
              value={x.name}
              onChange={(e) => setProfile((p) => ({ ...p, people: p.people.map((y, j) => (j === i ? { ...y, name: e.target.value } : y)) }))}
              className="h-9 w-64"
            />
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                aria-label={`Person ${i + 1} common name`}
                className="size-4 accent-[#000c66]"
                checked={x.common}
                onChange={(e) => setProfile((p) => ({ ...p, people: p.people.map((y, j) => (j === i ? { ...y, common: e.target.checked } : y)) }))}
              />
              Common name - only count when the brand is mentioned nearby
            </label>
            <Button variant="ghost" size="sm" onClick={() => setProfile((p) => ({ ...p, people: p.people.filter((_, j) => j !== i) }))}>Remove</Button>
          </div>
        ))}
        <Button variant="outline" size="sm" onClick={() => setProfile((p) => ({ ...p, people: [...p.people, { name: "", common: false }] }))}>Add person</Button>
      </div>

      <div className="space-y-2">
        <Button variant="ghost" size="sm" aria-expanded={showRules} onClick={() => setShowRules((s) => !s)}>
          {showRules ? "Hide generated rules" : "Show generated rules"}
        </Button>
        {showRules && (
          <div data-testid="generated-rules" className="rounded-md border bg-neutral-50 p-3">
            {previewError ? <p className="text-sm text-neutral-600">{previewError}</p> : <BrandRules rules={rules} />}
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={save} disabled={!setName.trim()}>Save set</Button>
        {savedName && <Button variant="outline" onClick={() => setDialog("delete")}>Delete set</Button>}
        {savedName && <Button variant="ghost" onClick={() => setDialog("detach")}>Switch to advanced editing</Button>}
      </div>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      {saved && <p role="status" className="text-sm text-green-800">{saved}</p>}

      <BrandTryPanel run={(text) => api.testBrandProfile(clean, text)} />

      <AlertDialog open={dialog !== null} onOpenChange={(o) => !busy && !o && setDialog(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{dialog === "delete" ? `Delete brand set "${savedName}"?` : `Switch "${savedName}" to advanced editing?`}</AlertDialogTitle>
            <AlertDialogDescription>
              {dialog === "delete"
                ? "It is removed from config.yaml (a backup is kept). Finished verifications keep the copy of the rules they used."
                : "The form answers are discarded and the set becomes raw regex rules, edited in the advanced editor. The rules themselves do not change."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={busy} onClick={(e) => { e.preventDefault(); void confirmDialog(); }}>
              {dialog === "delete" ? "Delete" : "Switch"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
