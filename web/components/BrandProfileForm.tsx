"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { BrandRules } from "@/components/BrandRules";
import { BrandTryPanel } from "@/components/BrandTryPanel";
import { NativeSelect } from "@/components/NativeSelect";
import { SuggestChips } from "@/components/SuggestChips";
import { TagInput } from "@/components/TagInput";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, errorMessage } from "@/lib/api";
import { CLOSENESS_LABELS, addValues, cleanProfile, emptyBrand, emptyWord } from "@/lib/brandProfile";
import type { BrandProfile, BrandRule, Closeness, EverydayWord, ProfileBrand, ProfileWarning, Suggestion } from "@/lib/types";

let idCounter = 0;
const newId = () => `brand-${++idCounter}`; // client-only card identity; never sent to the API

const without = <T,>(m: Record<string, T>, id: string) => Object.fromEntries(Object.entries(m).filter(([k]) => k !== id)) as Record<string, T>;

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

export function BrandProfileForm({ name, initial, stale, existingNames, suggestAvailable, onSaved, onDeleted, onDetached, onDirtyChange }: Props) {
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
  // Suggestions and descriptions are per brand card (by index) and never saved.
  const [ids, setIds] = useState<string[]>(() => initial.brands.map(newId)); // parallel to profile.brands
  const idsRef = useRef(ids);
  useEffect(() => { idsRef.current = ids; }, [ids]);
  const [suggestions, setSuggestions] = useState<Record<string, Suggestion>>({});
  const [descriptions, setDescriptions] = useState<Record<string, string>>({});
  const [suggesting, setSuggesting] = useState<string | null>(null);
  const [suggestErrors, setSuggestErrors] = useState<Record<string, string>>({});

  const snapshot = JSON.stringify({ n: setName, p: profile });
  useEffect(() => onDirtyChange(snapshot !== savedSnapshot), [snapshot, savedSnapshot, onDirtyChange]);

  // Preview on every change (debounced): warnings next to fields, and the generated rules.
  const clean = useMemo(() => cleanProfile(profile), [profile]);
  const hasBrandName = profile.brands.some((b) => b.name.trim() !== "");
  useEffect(() => {
    if (!hasBrandName) return; // nothing to preview yet; the panel shows a neutral hint instead
    let alive = true; // ignore responses for a profile that has since changed
    const t = setTimeout(() => {
      api
        .previewBrandProfile(clean)
        .then((r) => {
          if (!alive) return;
          setWarnings(r.warnings);
          setRules(r.rules);
          setPreviewError(null);
        })
        .catch((e) => {
          if (!alive) return;
          setWarnings([]);
          setRules([]);
          setPreviewError(errorMessage(e));
        });
    }, 400);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [clean, hasBrandName]);

  const updateBrand = (i: number, patch: Partial<ProfileBrand>) =>
    setProfile((p) => ({ ...p, brands: p.brands.map((b, j) => (j === i ? { ...b, ...patch } : b)) }));
  const updateWord = (i: number, patch: Partial<EverydayWord>) =>
    setProfile((p) => ({
      ...p,
      brands: p.brands.map((b, j) => (j === i && b.everyday_word ? { ...b, everyday_word: { ...b.everyday_word, ...patch } } : b)),
    }));
  const warningsFor = (i: number | null, field: string) =>
    (hasBrandName ? warnings : []).filter((w) => w.brand === i && w.field === field).map((w) => (
      <p key={w.message} className="text-xs text-amber-800">{w.message}</p>
    ));

  async function suggest(id: string) {
    const i = ids.indexOf(id);
    if (i < 0) return;
    setSuggestErrors((m) => without(m, id));
    setSuggesting(id);
    try {
      const r = await api.suggestBrandProfile(profile.brands[i].name.trim(), (descriptions[id] ?? "").trim());
      if (idsRef.current.includes(id)) setSuggestions((s) => ({ ...s, [id]: r.suggestion })); // card may be gone
    } catch (e) {
      if (idsRef.current.includes(id)) setSuggestErrors((m) => ({ ...m, [id]: errorMessage(e) }));
    } finally {
      setSuggesting((cur) => (cur === id ? null : cur));
    }
  }

  function removeBrand(i: number) {
    const id = ids[i];
    setProfile((p) => ({ ...p, brands: p.brands.filter((_, j) => j !== i) }));
    setIds((a) => a.filter((_, j) => j !== i));
    setSuggestions((m) => without(m, id));
    setDescriptions((m) => without(m, id));
    setSuggestErrors((m) => without(m, id));
  }

  const suggestedPeople = useMemo(() => {
    const seen = new Set<string>();
    const out: { name: string; common: boolean }[] = [];
    for (const id of ids) for (const x of suggestions[id]?.people ?? []) {
      const k = x.name.trim().toLowerCase();
      if (k && !seen.has(k)) { seen.add(k); out.push(x); }
    }
    return out;
  }, [ids, suggestions]);

  async function save() {
    setError(null);
    setSaved(null);
    const n = setName.trim();
    const sentSnapshot = JSON.stringify({ n: setName, p: profile }); // what is being saved, not what is typed meanwhile
    if (savedName === null && existingNames.includes(n)) {
      setError(`A set named ${n} already exists - pick another name.`);
      return;
    }
    try {
      const res = await api.saveBrandProfile(n, clean, savedName === null);
      setSavedSnapshot(sentSnapshot);
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
          These rules differ from what the form would produce, from a hand edit of config.yaml or an app update. Saving will replace them with the form&apos;s version.
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
          const id = ids[i];
          const sg = suggestions[id];
          const sw = sg?.everyday_word ?? null;
          return (
            <li key={id} className="space-y-4 rounded-md border p-4">
              <div className="flex items-center justify-between">
                <h3 className="text-base">{i === 0 ? "Brand" : `Brand ${n}`}</h3>
                {profile.brands.length > 1 && (
                  <Button variant="ghost" size="sm" onClick={() => removeBrand(i)}>
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
                >
                  {sg && <SuggestChips values={sg.handles} current={b.handles} allLabel="Add all handles" onAdd={(v) => updateBrand(i, { handles: addValues(b.handles, v) })} />}
                </TagInput>
              </div>
              <div className="flex flex-wrap items-end gap-3">
                <div className="min-w-64 flex-1 space-y-1.5">
                  <Label htmlFor={`b${i}-desc`}>One-line description (for Suggest)</Label>
                  <Input className="h-9" id={`b${i}-desc`} aria-label={`Brand ${n} description`} value={descriptions[id] ?? ""}
                    onChange={(e) => setDescriptions((d) => ({ ...d, [id]: e.target.value }))}
                    placeholder="e.g. Indian luggage maker, founder Sudhir Jatia" />
                </div>
                <Button variant="outline" className="h-9" disabled={!suggestAvailable || !b.name.trim() || suggesting !== null} onClick={() => suggest(id)}>
                  {suggesting === id ? "Suggesting..." : "Suggest"}
                </Button>
              </div>
              {i === 0 && !suggestAvailable && <p className="text-xs text-neutral-500">Suggest needs ANTHROPIC_API_KEY in repscore-pipeline/.env.</p>}
              {suggestErrors[id] && <p role="alert" className="text-sm text-red-700">{suggestErrors[id]}</p>}
              {sg?.notes && <p className="rounded-md bg-neutral-50 p-2 text-sm text-neutral-700">{sg.notes}</p>}
              <TagInput
                id={`b${i}-always`}
                label="Names that always mean this brand"
                ariaLabel={`Brand ${n} names that always mean this brand`}
                values={b.always}
                onChange={(v) => updateBrand(i, { always: v })}
                placeholder="Full name, ticker, other scripts - press Enter after each"
              >
                {sg && <SuggestChips values={sg.always} current={b.always} allLabel="Add all names" onAdd={(v) => updateBrand(i, { always: addValues(b.always, v) })} />}
              </TagInput>
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
              {sw && !w && (
                <Button variant="ghost" size="xs" aria-label={`Use everyday word ${sw.word}`}
                  onClick={() => updateBrand(i, { everyday_word: { ...emptyWord(sw.word), exact_case: sw.exact_case, closeness: sw.closeness } })}>
                  Suggested: treat &quot;{sw.word}&quot; as an everyday word
                </Button>
              )}
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
                  <TagInput id={`b${i}-confirm`} label="Words that confirm it's the brand" ariaLabel={`Brand ${n} confirming words`} values={w.confirm} onChange={(v) => updateWord(i, { confirm: v })} placeholder="e.g. luggage, bag, NSE" hint="Plurals are matched automatically. Brand names and people in this set also count, except people marked as a common name.">
                    {sw && <SuggestChips values={sw.confirm} current={w.confirm} allLabel="Add all confirming words" onAdd={(v) => updateWord(i, { confirm: addValues(w.confirm, v) })} />}
                    {warningsFor(i, "confirm")}
                  </TagInput>
                  <div className="grid gap-4 md:grid-cols-2">
                    <TagInput id={`b${i}-after`} label="Not the brand when followed by" ariaLabel={`Brand ${n} not followed by`} values={w.not_followed_by} onChange={(v) => updateWord(i, { not_followed_by: v })} placeholder="e.g. browser, tour">
                      {sw && <SuggestChips values={sw.not_followed_by} current={w.not_followed_by} allLabel="Add all followed-by words" onAdd={(v) => updateWord(i, { not_followed_by: addValues(w.not_followed_by, v) })} />}
                    </TagInput>
                    <TagInput id={`b${i}-before`} label="Not the brand when preceded by" ariaLabel={`Brand ${n} not preceded by`} values={w.not_preceded_by} onChange={(v) => updateWord(i, { not_preceded_by: v })} placeholder="e.g. Apple, jeep">
                      {sw && <SuggestChips values={sw.not_preceded_by} current={w.not_preceded_by} allLabel="Add all preceded-by words" onAdd={(v) => updateWord(i, { not_preceded_by: addValues(w.not_preceded_by, v) })} />}
                    </TagInput>
                    <TagInput id={`b${i}-sentence`} label="Not the brand in the same sentence as" ariaLabel={`Brand ${n} not in the same sentence as`} values={w.not_in_sentence_with} onChange={(v) => updateWord(i, { not_in_sentence_with: v })} placeholder="e.g. Serengeti, Kruger">
                      {sw && <SuggestChips values={sw.not_in_sentence_with} current={w.not_in_sentence_with} allLabel="Add all sentence words" onAdd={(v) => updateWord(i, { not_in_sentence_with: addValues(w.not_in_sentence_with, v) })} />}
                    </TagInput>
                    <TagInput id={`b${i}-phrases`} label="Exact phrases to ignore" ariaLabel={`Brand ${n} phrases to ignore`} values={w.ignore_phrases} onChange={(v) => updateWord(i, { ignore_phrases: v })} placeholder="e.g. Ritz-Carlton">
                      {sw && <SuggestChips values={sw.ignore_phrases} current={w.ignore_phrases} allLabel="Add all phrases" onAdd={(v) => updateWord(i, { ignore_phrases: addValues(w.ignore_phrases, v) })} />}
                      {warningsFor(i, "ignore_phrases")}
                    </TagInput>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ol>
      <Button variant="outline" onClick={() => {
        setProfile((p) => ({ ...p, brands: [...p.brands, emptyBrand()] }));
        setIds((a) => [...a, newId()]);
      }}>Add brand</Button>

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
        <SuggestChips note="verify - from AI memory" allLabel="Add all people"
          values={suggestedPeople.map((x) => x.name)} current={profile.people.map((x) => x.name)}
          onAdd={(names) => setProfile((p) => ({
            ...p,
            people: [...p.people, ...suggestedPeople.filter((x) => names.includes(x.name))],
          }))} />
        <Button variant="outline" size="sm" onClick={() => setProfile((p) => ({ ...p, people: [...p.people, { name: "", common: false }] }))}>Add person</Button>
      </div>

      <div className="space-y-2">
        <Button variant="ghost" size="sm" aria-expanded={showRules} onClick={() => setShowRules((s) => !s)}>
          {showRules ? "Hide generated rules" : "Show generated rules"}
        </Button>
        {showRules && (
          <div data-testid="generated-rules" className="rounded-md border bg-neutral-50 p-3">
            {!hasBrandName ? <p className="text-sm text-neutral-600">Fill in a brand name to see the rules.</p> : previewError ? <p className="text-sm text-neutral-600">{previewError}</p> : <BrandRules rules={rules} />}
          </div>
        )}
      </div>

      {hasBrandName && previewError && <p className="text-sm text-neutral-600">{previewError}</p>}
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={save} disabled={!setName.trim()}>Save set</Button>
        {savedName && <Button variant="outline" onClick={() => setDialog("delete")}>Delete set</Button>}
        {savedName && <Button variant="ghost" onClick={() => setDialog("detach")}>Switch to advanced editing</Button>}
      </div>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      {saved && snapshot === savedSnapshot && <p role="status" className="text-sm text-green-800">{saved}</p>}

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
