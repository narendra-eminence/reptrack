"use client";

import { useSearchParams } from "next/navigation";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { BrandProfileForm } from "@/components/BrandProfileForm";
import { CleaningDetailsPanel } from "@/components/CleaningDetailsPanel";
import { emptyDetails } from "@/lib/cleaning";
import { HAND_WRITTEN_NOTE } from "@/components/BrandSummary";
import { DeleteSetDialog } from "@/components/DeleteSetDialog";
import { Button } from "@/components/ui/button";
import { api, errorMessage } from "@/lib/api";
import { emptyProfile } from "@/lib/brandProfile";
import type { BrandSet } from "@/lib/types";
import { cn } from "@/lib/utils";

export type Selection = { kind: "new" } | { kind: "set"; name: string };

/** A set written by hand in config.yaml: it still verifies, but the app never shows or edits its rules. Its cleaning
 * details are editable, since verification never reads them. */
function HandWrittenSet({
  set, onDeleted, onCleaningSaved, onDirtyChange,
}: { set: BrandSet; onDeleted: () => void; onCleaningSaved: () => void; onDirtyChange: (dirty: boolean) => void }) {
  const name = set.name;
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirmDelete() {
    setBusy(true);
    setError(null);
    try {
      await api.deleteBrand(name);
      setOpen(false);
      onDeleted();
    } catch (e) {
      setError(errorMessage(e));
      setOpen(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-4">
      <h2 className="text-xl break-words">{name}</h2>
      <p className="max-w-prose text-sm text-neutral-600">
        {HAND_WRITTEN_NOTE}
      </p>
      <Button variant="outline" onClick={() => setOpen(true)}>Delete set</Button>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <DeleteSetDialog name={name} open={open} busy={busy} onOpenChange={setOpen} onConfirm={confirmDelete} />
      <CleaningDetailsPanel set={set} onSaved={onCleaningSaved} onDirtyChange={onDirtyChange} />
    </section>
  );
}

export function BrandWorkspace() {
  // /brands?set=<name> opens that set (the Clean step links here to edit its cleaning details).
  const requested = useSearchParams().get("set");
  const [sets, setSets] = useState<BrandSet[]>([]);
  const [selection, setSelection] = useState<Selection>(() => (requested ? { kind: "set", name: requested } : { kind: "new" }));
  const [version, setVersion] = useState(0); // remounts the editor when the selection is replaced
  const [error, setError] = useState<string | null>(null);
  // Unsaved edits in the brand form and in the cleaning details are tracked apart; either one guards a switch.
  const formDirty = useRef(false);
  const cleaningDirty = useRef(false);
  const onDirtyChange = useCallback((d: boolean) => {
    formDirty.current = d;
  }, []);
  const onCleaningDirtyChange = useCallback((d: boolean) => {
    cleaningDirty.current = d;
  }, []);

  const load = useCallback(async () => {
    try {
      setSets((await api.brands()).sets);
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);

  useEffect(() => {
    let alive = true;
    api
      .brands()
      .then((r) => {
        if (!alive) return;
        setSets(r.sets);
        // A ?set= naming no set (deleted since the link was made) opens a new set instead of loading forever.
        setSelection((sel) => (sel.kind === "set" && !r.sets.some((s) => s.name === sel.name) ? { kind: "new" } : sel));
      })
      .catch((e) => alive && setError(errorMessage(e)));
    return () => {
      alive = false;
    };
  }, []);

  function select(next: Selection) {
    if ((formDirty.current || cleaningDirty.current) && !window.confirm("Discard unsaved changes?")) return;
    formDirty.current = cleaningDirty.current = false;
    setError(null);
    setSelection(next);
    setVersion((v) => v + 1);
  }

  // A save keeps the same form mounted (so its "Saved" notice stays); only the selection moves to the saved set.
  async function afterSave(name: string) {
    formDirty.current = false;
    await load();
    setSelection({ kind: "set", name });
  }

  async function afterDelete() {
    formDirty.current = cleaningDirty.current = false;
    await load();
    setSelection({ kind: "new" });
    setVersion((v) => v + 1);
  }

  const current = selection.kind === "set" ? sets.find((s) => s.name === selection.name) ?? null : null;
  const names = sets.map((s) => s.name);

  // A form set's answers come with the set list, so opening one needs no further request. The form only reads
  // `initial` when it mounts, so the list reloading after a save does not reset it.
  let editor: ReactNode;
  if (current && !current.managed) {
    editor = (
      <HandWrittenSet
        key={`hand-${current.name}-${version}`}
        set={current}
        onDeleted={afterDelete}
        onCleaningSaved={() => {
          cleaningDirty.current = false;
          void load();
        }}
        onDirtyChange={onCleaningDirtyChange}
      />
    );
  } else if (selection.kind === "new" || current?.profile) {
    editor = (
      <BrandProfileForm
        key={`form-${version}`}
        name={current?.name ?? null}
        initial={current?.profile ?? emptyProfile()}
        initialCleaning={current?.cleaning.details ?? emptyDetails()}
        stale={current?.stale ?? false}
        existingNames={names}
        onSaved={afterSave}
        onDeleted={afterDelete}
        onDirtyChange={onDirtyChange}
      />
    );
  } else {
    editor = error ? null : <p className="text-sm text-neutral-600">Loading...</p>;
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[240px_minmax(0,1fr)]">
      <aside className="space-y-2">
        <Button variant="outline" className="w-full" onClick={() => select({ kind: "new" })}>New set</Button>
        <ul className="space-y-1">
          {sets.map((s) => {
            const active = current?.name === s.name;
            return (
              <li key={s.name}>
                <button
                  type="button"
                  onClick={() => select({ kind: "set", name: s.name })}
                  className={cn(
                    "flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm",
                    active ? "bg-brand-navy text-white" : "hover:bg-neutral-100",
                  )}
                >
                  <span className="truncate">{s.name}</span>
                  <span
                    className={cn(
                      "shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium",
                      s.managed
                        ? active ? "bg-white/20 text-white" : "bg-neutral-100 text-neutral-600"
                        : active ? "text-white/70 ring-1 ring-white/30 ring-inset" : "text-neutral-500 ring-1 ring-neutral-200 ring-inset",
                    )}
                  >
                    {s.managed ? "Form" : "Hand-written"}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </aside>
      <div className="min-w-0">
        {error && <p role="alert" className="mb-4 text-sm text-red-700">{error}</p>}
        {editor}
      </div>
    </div>
  );
}
