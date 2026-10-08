"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { BrandProfileForm } from "@/components/BrandProfileForm";
import { RawSetEditor } from "@/components/RawSetEditor";
import { api, errorMessage } from "@/lib/api";
import { emptyProfile } from "@/lib/brandProfile";
import type { BrandProfile, BrandSet } from "@/lib/types";
import { cn } from "@/lib/utils";

export type Selection = { kind: "new-form" } | { kind: "new-raw" } | { kind: "set"; name: string };

export function BrandWorkspace() {
  const [sets, setSets] = useState<BrandSet[]>([]);
  const [selection, setSelection] = useState<Selection>({ kind: "new-form" });
  const [version, setVersion] = useState(0); // remounts the editor when the selection is replaced
  const [error, setError] = useState<string | null>(null);
  const [suggestAvailable, setSuggestAvailable] = useState(false);
  const [profile, setProfile] = useState<{ name: string; profile: BrandProfile } | null>(null);
  const dirty = useRef(false);
  const onDirtyChange = useCallback((d: boolean) => {
    dirty.current = d;
  }, []);

  const load = useCallback(async () => {
    try {
      setSets((await api.brands()).sets);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);

  useEffect(() => {
    let alive = true;
    api.brands().then((r) => alive && setSets(r.sets)).catch((e) => alive && setError(errorMessage(e)));
    api.health().then((h) => alive && setSuggestAvailable(Boolean(h.suggest_available))).catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  function select(next: Selection) {
    if (dirty.current && !window.confirm("Discard unsaved changes?")) return;
    dirty.current = false;
    setSelection(next);
    setProfile(null);
    setVersion((v) => v + 1);
  }

  // The editor keeps its own state after a save (so its "Saved" notice stays); only the selection moves to the saved set.
  async function afterSave(name: string) {
    dirty.current = false;
    await load();
    setSelection({ kind: "set", name });
  }

  // A form save keeps the saved profile, so the same form instance stays mounted without refetching it.
  async function afterFormSave(name: string, saved: BrandProfile) {
    dirty.current = false;
    await load();
    setProfile({ name, profile: saved });
    setSelection({ kind: "set", name });
  }

  // The set is raw now: reselect it and remount so the raw editor opens.
  async function afterDetach(name: string) {
    dirty.current = false;
    await load();
    setProfile(null);
    setSelection({ kind: "set", name });
    setVersion((v) => v + 1);
  }

  async function afterDelete() {
    dirty.current = false;
    await load();
    setSelection({ kind: "new-form" });
    setVersion((v) => v + 1);
  }

  const current = selection.kind === "set" ? sets.find((s) => s.name === selection.name) ?? null : null;
  const names = sets.map((s) => s.name);
  const isRaw = selection.kind === "new-raw" || (current !== null && !current.managed);
  const key = `${isRaw ? "raw" : "form"}-${version}`;
  const currentName = current?.name;
  const currentManaged = current?.managed;

  useEffect(() => {
    if (!currentName || !currentManaged || profile?.name === currentName) return;
    let alive = true;
    api
      .brandProfile(currentName)
      .then((r) => alive && setProfile({ name: currentName, profile: r.profile }))
      .catch((e) => alive && setError(errorMessage(e)));
    return () => {
      alive = false;
    };
  }, [currentName, currentManaged, profile?.name, version]);

  return (
    <div className="grid gap-8 lg:grid-cols-[240px_minmax(0,1fr)]">
      <aside className="space-y-2">
        <Button variant="outline" className="w-full" onClick={() => select({ kind: "new-form" })}>New set</Button>
        <Button variant="ghost" size="sm" className="w-full text-neutral-600" onClick={() => select({ kind: "new-raw" })}>
          New raw set
        </Button>
        <ul className="space-y-1">
          {sets.map((s) => (
            <li key={s.name}>
              <button
                type="button"
                onClick={() => select({ kind: "set", name: s.name })}
                className={cn(
                  "flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm",
                  current?.name === s.name ? "bg-brand-navy text-white" : "hover:bg-neutral-100",
                )}
              >
                <span className="truncate">{s.name}</span>
                {s.managed && (
                  <span
                    className={cn(
                      "shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium",
                      current?.name === s.name ? "bg-white/20 text-white" : "bg-neutral-100 text-neutral-600",
                    )}
                  >
                    Form
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      </aside>
      <div className="min-w-0">
        {error && <p role="alert" className="mb-4 text-sm text-red-700">{error}</p>}
        {isRaw ? (
          <RawSetEditor key={key} set={current} existingNames={names} onSaved={afterSave} onDeleted={afterDelete} onDirtyChange={onDirtyChange} />
        ) : selection.kind === "new-form" || (profile && current && profile.name === current.name) ? (
          <BrandProfileForm
            key={key}
            name={current?.name ?? null}
            initial={selection.kind === "new-form" || !profile ? emptyProfile() : profile.profile}
            stale={current?.stale ?? false}
            existingNames={names}
            suggestAvailable={suggestAvailable}
            onSaved={afterFormSave}
            onDeleted={afterDelete}
            onDetached={afterDetach}
            onDirtyChange={onDirtyChange}
          />
        ) : (
          <p className="text-sm text-neutral-600">Loading...</p>
        )}
      </div>
    </div>
  );
}
