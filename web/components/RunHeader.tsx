"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { StatusBadge } from "@/components/StatusBadge";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { api, errorMessage } from "@/lib/api";
import { fmtDateTime } from "@/lib/format";
import type { RunDetail } from "@/lib/types";

export function RunHeader({ run }: { run: RunDetail }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      await api.deleteRun(run.id);
      router.push("/");
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  return (
    <div data-testid="run-header" className="flex items-start justify-between gap-6">
      <div className="min-w-0">
        <div className="flex items-center gap-3">
          <h1 className="truncate text-2xl" title={run.name}>{run.name}</h1>
          <StatusBadge status={run.status} />
        </div>
        <p className="mt-1 text-sm text-neutral-600">Created {fmtDateTime(run.created_at)}</p>
      </div>
      <Button variant="outline" disabled={!!run.active_job} onClick={() => { setError(null); setOpen(true); }}>Delete run</Button>
      <AlertDialog open={open} onOpenChange={(o) => { if (!busy) { setOpen(o); if (!o) setError(null); } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this run?</AlertDialogTitle>
            <AlertDialogDescription>Its queries, results, verifications and exported files are removed. This cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
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
