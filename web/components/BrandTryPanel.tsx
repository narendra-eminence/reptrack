"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { errorMessage } from "@/lib/api";
import type { TryResult } from "@/lib/types";

function Highlighted({ e }: {
  e: { text: string; before: string; after: string; cut_before: boolean; cut_after: boolean };
}) {
  return (
    <>
      {e.cut_before && "… "}
      {e.before && `${e.before} `}
      <mark className="rounded-sm bg-amber-100 px-0.5 text-inherit">{e.text}</mark>
      {e.after && ` ${e.after}`}
      {e.cut_after && " …"}
    </>
  );
}

export function BrandTryPanel({ run }: { run: (text: string) => Promise<TryResult> }) {
  const [sample, setSample] = useState("");
  const [tried, setTried] = useState<TryResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function tryRules() {
    setError(null);
    try {
      setTried(await run(sample));
    } catch (e) {
      setTried(null);
      setError(errorMessage(e));
    }
  }

  return (
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
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      {tried && (
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <p className="text-sm font-semibold">Counted ({tried.hits.length})</p>
            <ul data-testid="try-hits" className="mt-1 space-y-1 text-sm">
              {tried.hits.map((h, i) => (
                <li key={`${h.brand}-${h.offset}-${i}`}>
                  <span className="font-medium">{h.brand}</span>: <Highlighted e={h} />
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="text-sm font-semibold">Not counted ({tried.excluded.length})</p>
            <ul data-testid="try-excluded" className="mt-1 space-y-1 text-sm">
              {tried.excluded.map((x, i) => (
                <li key={`${x.brand}-${x.offset}-${i}`}>
                  <Highlighted e={x} /> - {x.reason}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
