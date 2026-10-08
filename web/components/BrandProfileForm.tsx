"use client";

import { type ReactNode, useEffect, useMemo, useState } from "react";
import { DeleteSetDialog } from "@/components/DeleteSetDialog";
import { TagInput } from "@/components/TagInput";
import { TestSentences } from "@/components/TestSentences";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { api, errorMessage } from "@/lib/api";
import { type CheckResult, cleanProfile, emptyBrand, emptyExclusions, namedBrands, remapCheck } from "@/lib/brandProfile";
import type { BrandProfile, Exclusions, Person, ProfileBrand, TestResult, TestSentence } from "@/lib/types";

let idCounter = 0;
const newId = () => `brand-${++idCounter}`; // client-only card identity; never sent to the API

const FIELDS_WITH_WARNINGS = new Set(["confirming_words", "phrases"]);

type Props = {
  name: string | null; // null = new set
  initial: BrandProfile;
  stale: boolean;
  existingNames: string[];
  onSaved: (name: string, profile: BrandProfile) => void;
  onDeleted: () => void;
  onDirtyChange: (dirty: boolean) => void;
};

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <div className="space-y-3 border-t pt-4">
      <div>
        <h4 className="text-sm font-semibold">{title}</h4>
        {hint && <p className="text-xs text-neutral-500">{hint}</p>}
      </div>
      {children}
    </div>
  );
}

function failingNote(tests: TestResult[]): string {
  const n = tests.filter((t) => !t.passed).length;
  if (!n) return "";
  return n === 1 ? " 1 test sentence does not give the expected result." : ` ${n} test sentences do not give the expected result.`;
}

export function BrandProfileForm({ name, initial, stale, existingNames, onSaved, onDeleted, onDirtyChange }: Props) {
  const [savedName, setSavedName] = useState(name); // becomes the set's name after a new set is saved, so the form stays mounted
  const [setName, setSetName] = useState(name ?? "");
  const [profile, setProfile] = useState<BrandProfile>(initial);
  const [savedSnapshot, setSavedSnapshot] = useState(() => JSON.stringify({ n: name ?? "", p: initial }));
  const [ids, setIds] = useState<string[]>(() => initial.brands.map(newId)); // parallel to profile.brands
  const [check, setCheck] = useState<CheckResult | null>(null);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);

  const snapshot = JSON.stringify({ n: setName, p: profile });
  useEffect(() => onDirtyChange(snapshot !== savedSnapshot), [snapshot, savedSnapshot, onDirtyChange]);

  // Check on every change (debounced): warnings next to fields and the result of every test sentence. Brands without
  // a name are left out (the API would refuse them) and the other cards keep their results.
  const clean = useMemo(() => cleanProfile(profile), [profile]);
  const named = useMemo(() => namedBrands(clean), [clean]);
  const hasBrandName = named.indexes.length > 0;
  useEffect(() => {
    if (!named.indexes.length) return; // nothing to check yet
    let alive = true; // ignore responses for a profile that has since changed
    const t = setTimeout(() => {
      api
        .checkBrandProfile(named.profile)
        .then((r) => {
          if (!alive) return;
          setCheck(remapCheck(r, named.indexes));
          setCheckError(null);
        })
        .catch((e) => {
          if (!alive) return;
          setCheck(null);
          setCheckError(errorMessage(e));
        });
    }, 400);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [named]);

  const updateBrand = (i: number, patch: Partial<ProfileBrand>) =>
    setProfile((p) => ({ ...p, brands: p.brands.map((b, j) => (j === i ? { ...b, ...patch } : b)) }));
  const updateExclusions = (i: number, patch: Partial<Exclusions>) =>
    setProfile((p) => ({ ...p, brands: p.brands.map((b, j) => (j === i ? { ...b, exclusions: { ...b.exclusions, ...patch } } : b)) }));
  const updatePerson = (i: number, m: number, patch: Partial<Person>) =>
    setProfile((p) => ({
      ...p,
      brands: p.brands.map((b, j) => (j === i ? { ...b, people: b.people.map((x, k) => (k === m ? { ...x, ...patch } : x)) } : b)),
    }));
  // Switching to No clears the common-word fields, so hidden values can never block a save.
  const setCommonWord = (i: number, yes: boolean) =>
    updateBrand(i, yes ? { common_word: true } : { common_word: false, confirming_words: [], exclusions: emptyExclusions() });

  const shownWarnings = hasBrandName && check ? check.warnings : [];
  const warningsFor = (i: number, field: string) =>
    shownWarnings.filter((w) => w.brand === i && w.field === field).map((w) => (
      <p key={w.message} className="text-xs text-amber-800">{w.message}</p>
    ));
  const otherWarnings = (i: number) =>
    shownWarnings.filter((w) => (w.brand === i && !FIELDS_WITH_WARNINGS.has(w.field)) || (i === 0 && w.brand === null)).map((w) => (
      <p key={w.message} className="text-xs text-amber-800">{w.message}</p>
    ));

  // A result is shown only for the row it was computed for; an edited or shifted row waits for the next check.
  const resultFor = (i: number, t: TestSentence[]) => (j: number) => {
    if (!hasBrandName || !check) return null;
    const r = check.tests.find((x) => x.brand === i && x.index === j);
    return r && r.text === t[j]?.text.trim() && r.expect === t[j]?.expect ? r : null;
  };

  function addBrand() {
    setProfile((p) => ({ ...p, brands: [...p.brands, emptyBrand()] }));
    setIds((a) => [...a, newId()]);
  }

  function removeBrand(i: number) {
    setProfile((p) => ({ ...p, brands: p.brands.filter((_, j) => j !== i) }));
    setIds((a) => a.filter((_, j) => j !== i));
    setCheck(null); // its indexes no longer line up with the cards
  }

  async function save() {
    if (saving) return;
    setError(null);
    setSaved(null);
    const n = setName.trim();
    const sentSnapshot = JSON.stringify({ n: setName, p: profile }); // what is being saved, not what is typed meanwhile
    if (savedName === null && existingNames.includes(n)) {
      setError(`A set named ${n} already exists - pick another name.`);
      return;
    }
    setSaving(true);
    try {
      const res = await api.saveBrandProfile(n, clean, savedName === null);
      setSavedSnapshot(sentSnapshot);
      setSaved(`Saved. The previous config.yaml was backed up to ${res.backup.split("/").pop()}.${failingNote(res.tests)}`);
      setSavedName(res.name);
      onSaved(res.name, clean);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  async function confirmDelete() {
    if (!savedName) return;
    setBusy(true);
    try {
      await api.deleteBrand(savedName);
      setDeleteOpen(false);
      onDeleted();
    } catch (e) {
      setError(errorMessage(e));
      setDeleteOpen(false);
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
          const id = ids[i];
          return (
            <li key={id} className="space-y-4 rounded-md border p-4">
              <div className="flex min-h-7 items-center justify-between gap-3">
                <h3 className="text-base">Brand {n}</h3>
                {profile.brands.length > 1 && (
                  <Button variant="ghost" size="sm" onClick={() => removeBrand(i)}>Remove brand</Button>
                )}
              </div>

              <div className="space-y-4">
                <div className="space-y-1.5 md:max-w-sm">
                  <Label htmlFor={`b${i}-name`}>Brand name</Label>
                  <Input className="h-9" id={`b${i}-name`} aria-label={`Brand ${n} name`} value={b.name} onChange={(e) => updateBrand(i, { name: e.target.value })} placeholder="e.g. Safari" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor={`b${i}-desc`}>Description</Label>
                  <Textarea
                    id={`b${i}-desc`}
                    aria-label={`Brand ${n} description`}
                    rows={3}
                    maxLength={500}
                    value={b.description}
                    onChange={(e) => updateBrand(i, { description: e.target.value })}
                    placeholder="What the brand is, for whoever edits this set next. Not used for matching."
                    className="field-sizing-fixed resize-y"
                  />
                </div>
                <TagInput
                  id={`b${i}-aliases`}
                  label="Other brand names / aliases"
                  ariaLabel={`Brand ${n} aliases`}
                  values={b.aliases}
                  onChange={(v) => updateBrand(i, { aliases: v })}
                  placeholder="Full name, ticker, other scripts - press Enter after each"
                  hint="Each of these always counts as the brand."
                />
                <div className="grid gap-4 md:grid-cols-2">
                  <TagInput
                    id={`b${i}-hashtags`}
                    label="Hashtags"
                    ariaLabel={`Brand ${n} hashtags`}
                    values={b.hashtags}
                    onChange={(v) => updateBrand(i, { hashtags: v })}
                    placeholder="e.g. safaribags"
                    hint="Without #"
                  />
                  <TagInput
                    id={`b${i}-handles`}
                    label="Social handles"
                    ariaLabel={`Brand ${n} handles`}
                    values={b.handles}
                    onChange={(v) => updateBrand(i, { handles: v })}
                    placeholder="e.g. safari_india"
                    hint="Without @"
                  />
                </div>

                <fieldset className="space-y-1.5">
                  <legend className="text-sm leading-none font-medium">Is the brand name a common word?</legend>
                  <div className="flex items-center gap-5 pt-1.5">
                    {([[true, "Yes"], [false, "No"]] as const).map(([value, label]) => (
                      <label key={label} className="flex items-center gap-2 text-sm">
                        <input
                          type="radio"
                          name={`b${i}-common`}
                          aria-label={`Brand ${n} common word ${label.toLowerCase()}`}
                          className="size-4 accent-[#000c66]"
                          checked={b.common_word === value}
                          onChange={() => setCommonWord(i, value)}
                        />
                        {label}
                      </label>
                    ))}
                  </div>
                  <p className="text-xs text-neutral-500">
                    Like Safari or VIP. When Yes, the name counts only with its exact capitals and a confirming word nearby.
                  </p>
                </fieldset>

                {b.common_word && (
                  <div className="space-y-4 rounded-md border bg-neutral-50/60 p-4">
                    <TagInput
                      id={`b${i}-confirm`}
                      label="Words that confirm this is the brand"
                      ariaLabel={`Brand ${n} confirming words`}
                      values={b.confirming_words}
                      onChange={(v) => updateBrand(i, { confirming_words: v })}
                      placeholder="e.g. luggage, bag, NSE"
                      hint="One of these must appear within about 100 characters. Plurals are matched automatically. Brand names, aliases and people in this set also count, except people who only count when the brand is nearby."
                    >
                      {warningsFor(i, "confirming_words")}
                    </TagInput>
                    <div className="space-y-3">
                      <h5 className="text-sm font-semibold">Words that mean it is NOT the brand</h5>
                      <div className="grid gap-4 md:grid-cols-3">
                        <TagInput id={`b${i}-after`} label="After the brand name" ariaLabel={`Brand ${n} not after`} values={b.exclusions.followed_by} onChange={(v) => updateExclusions(i, { followed_by: v })} placeholder="e.g. browser, tour" />
                        <TagInput id={`b${i}-before`} label="Before the brand name" ariaLabel={`Brand ${n} not before`} values={b.exclusions.preceded_by} onChange={(v) => updateExclusions(i, { preceded_by: v })} placeholder="e.g. Apple, jeep" />
                        <TagInput id={`b${i}-nearby`} label="Nearby / same sentence" ariaLabel={`Brand ${n} not nearby`} values={b.exclusions.nearby} onChange={(v) => updateExclusions(i, { nearby: v })} placeholder="e.g. Serengeti, Kruger" />
                      </div>
                    </div>
                    <TagInput
                      id={`b${i}-phrases`}
                      label="Exact phrases to ignore"
                      ariaLabel={`Brand ${n} phrases to ignore`}
                      values={b.exclusions.phrases}
                      onChange={(v) => updateExclusions(i, { phrases: v })}
                      placeholder="e.g. Safari browser extension"
                      hint="A mention inside one of these phrases never counts."
                    >
                      {warningsFor(i, "phrases")}
                    </TagInput>
                  </div>
                )}
                {otherWarnings(i)}
              </div>

              <Section title="People associated with the brand" hint="Founders and leaders. Their names count as mentions of the brand.">
                {b.people.length > 0 && (
                  <table className="w-full table-fixed text-sm">
                    <thead>
                      <tr className="text-left text-xs text-neutral-500">
                        <th scope="col" className="pb-1.5 font-medium">Person</th>
                        <th scope="col" className="w-28 pb-1.5 text-center font-medium sm:w-56">Only count when brand is nearby</th>
                        <th scope="col" className="w-20 pb-1.5"><span className="sr-only">Remove</span></th>
                      </tr>
                    </thead>
                    <tbody>
                      {b.people.map((x, m) => (
                        <tr key={m}>
                          <td className="py-1 pr-2">
                            <Input
                              className="h-8"
                              aria-label={`Brand ${n} person ${m + 1} name`}
                              value={x.name}
                              onChange={(e) => updatePerson(i, m, { name: e.target.value })}
                              placeholder="e.g. Sudhir Jatia"
                            />
                          </td>
                          <td className="py-1 text-center">
                            <input
                              type="checkbox"
                              aria-label={`Brand ${n} person ${m + 1} only when brand nearby`}
                              className="size-4 align-middle accent-[#000c66]"
                              checked={x.require_brand_nearby}
                              onChange={(e) => updatePerson(i, m, { require_brand_nearby: e.target.checked })}
                            />
                          </td>
                          <td className="py-1 text-right">
                            <Button
                              variant="ghost"
                              size="sm"
                              aria-label={`Brand ${n} remove person ${m + 1}`}
                              onClick={() => updateBrand(i, { people: b.people.filter((_, k) => k !== m) })}
                            >
                              Remove
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                <Button variant="outline" size="sm" onClick={() => updateBrand(i, { people: [...b.people, { name: "", require_brand_nearby: false }] })}>
                  Add person
                </Button>
              </Section>

              <div className="border-t pt-4">
                <TestSentences
                  brand={n}
                  tests={b.tests}
                  onChange={(tests) => updateBrand(i, { tests })}
                  brandNames={clean.brands.map((x) => x.name)}
                  resultFor={resultFor(i, b.tests)}
                  unnamed={!clean.brands[i].name}
                  unchecked={checkError !== null}
                />
              </div>
            </li>
          );
        })}
      </ol>
      <Button variant="outline" onClick={addBrand}>Add another brand</Button>

      {hasBrandName && checkError && <p className="text-sm text-neutral-600">{checkError}</p>}
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={save} disabled={!setName.trim() || saving}>{saving ? "Saving..." : "Save set"}</Button>
        {savedName && <Button variant="outline" onClick={() => setDeleteOpen(true)}>Delete set</Button>}
      </div>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      {saved && snapshot === savedSnapshot && <p role="status" className="text-sm text-green-800">{saved}</p>}

      <DeleteSetDialog name={savedName} open={deleteOpen} busy={busy} onOpenChange={setDeleteOpen} onConfirm={confirmDelete} />
    </section>
  );
}
