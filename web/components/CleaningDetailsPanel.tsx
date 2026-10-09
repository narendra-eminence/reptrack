"use client";

import { useEffect, useState } from "react";
import { CLEANING_HINT, CleaningDetailsFields } from "@/components/CleaningDetailsFields";
import { Button } from "@/components/ui/button";
import { api, errorMessage } from "@/lib/api";
import type { BrandSet, CleaningDetails } from "@/lib/types";

/** Cleaning details of a hand-written set: its rules are read-only, so the details have their own Save. A form set
 * edits them inside the brand form and saves them with the set. */
export function CleaningDetailsPanel({
  set, onSaved, onDirtyChange,
}: { set: BrandSet; onSaved: () => void; onDirtyChange: (dirty: boolean) => void }) {
  const [details, setDetails] = useState<CleaningDetails>(set.cleaning.details);
  const [savedSnapshot, setSavedSnapshot] = useState(() => JSON.stringify(set.cleaning.details));
  const [saved, setSaved] = useState(set.cleaning.saved);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const edited = JSON.stringify(details) !== savedSnapshot;
  useEffect(() => onDirtyChange(edited), [edited, onDirtyChange]);
  // Suggestions that were never saved (the form's handles) can be saved as they are.
  const canSave = !saved || edited;

  async function save() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const r = await api.saveCleaningDetails(set.name, details);
      setDetails(r.details);
      setSaved(true);
      setSavedSnapshot(JSON.stringify(r.details));
      setNotice(`Saved. The previous config.yaml was backed up to ${r.backup?.split("/").pop()}.`);
      onSaved();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section data-testid="cleaning-details-panel" aria-labelledby="cleaning-heading" className="space-y-4 border-t pt-6">
      <div>
        <h3 id="cleaning-heading" className="text-lg">Cleaning details</h3>
        <p className="mt-1 max-w-prose text-sm text-neutral-600">{CLEANING_HINT}</p>
      </div>
      <CleaningDetailsFields
        value={details}
        onChange={(next) => {
          setNotice(null);
          setDetails(next);
        }}
      />
      <div className="flex items-center gap-3">
        <Button variant="outline" disabled={!canSave || busy} onClick={save}>Save cleaning details</Button>
        {notice && <p role="status" className="text-sm text-green-800">{notice}</p>}
      </div>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    </section>
  );
}
