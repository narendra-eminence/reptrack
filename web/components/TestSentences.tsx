"use client";

import { useState } from "react";
import { MatchExplanation } from "@/components/MatchExplanation";
import { NativeSelect } from "@/components/NativeSelect";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { TestResult, TestSentence } from "@/lib/types";
import { cn } from "@/lib/utils";

export const MAX_TESTS = 50;
const MAX_TEST_CHARS = 1000;

type Expect = TestSentence["expect"];

function ResultBadge({ result, unchecked }: { result: TestResult | null; unchecked: boolean }) {
  const [label, tone] = result
    ? result.passed ? ["Passes", "bg-green-50 text-green-800 ring-green-200"] : ["Fails", "bg-red-50 text-red-800 ring-red-200"]
    : unchecked ? ["Not checked", "bg-neutral-50 text-neutral-500 ring-neutral-200"] : ["Checking...", "bg-neutral-50 text-neutral-500 ring-neutral-200"];
  return (
    <span data-testid="test-result" className={cn("inline-flex h-6 w-24 shrink-0 items-center justify-center rounded-md px-2 text-xs font-medium ring-1 ring-inset", tone)}>
      {label}
    </span>
  );
}

function ExpectSelect(props: { value: Expect; onChange: (v: Expect) => void; "aria-label": string; id?: string }) {
  return (
    <NativeSelect
      id={props.id}
      aria-label={props["aria-label"]}
      className="h-8 w-32"
      value={props.value}
      onChange={(e) => props.onChange(e.target.value as Expect)}
    >
      <option value="match">Match</option>
      <option value="no_match">Not a match</option>
    </NativeSelect>
  );
}

/**
 * A brand's saved test sentences with their live results. `resultFor` returns the latest check result for a row,
 * or null while it is pending; `unchecked` means the last check failed, so no result is coming.
 */
export function TestSentences({
  brand, tests, onChange, resultFor, unchecked,
}: {
  brand: number; // 1-based, for labels
  tests: TestSentence[];
  onChange: (tests: TestSentence[]) => void;
  resultFor: (index: number) => TestResult | null;
  unchecked: boolean;
}) {
  const [text, setText] = useState("");
  const [expect, setExpect] = useState<Expect>("match");
  const full = tests.length >= MAX_TESTS;

  function add() {
    const t = text.trim();
    if (!t || full) return;
    onChange([...tests, { text: t, expect }]);
    setText("");
  }

  return (
    <section aria-label={`Brand ${brand} test configuration`} className="space-y-3">
      <div>
        <h4 className="text-sm font-semibold">Test configuration</h4>
        <p className="text-xs text-neutral-500">
          Sentences that should or should not count as this brand. They are saved with the set and checked on every change.
        </p>
      </div>
      <ul data-testid={`tests-brand-${brand}`} className={cn("space-y-2", !tests.length && "hidden")}>
        {tests.map((t, i) => {
          const result = resultFor(i);
          return (
            <li key={i} className="space-y-2 rounded-md border p-3">
              <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
                <p className="min-w-48 flex-1 pt-1 text-sm break-words">{t.text}</p>
                <div className="flex items-center gap-2">
                  <ExpectSelect
                    aria-label={`Brand ${brand} test ${i + 1} expectation`}
                    value={t.expect}
                    onChange={(v) => onChange(tests.map((x, j) => (j === i ? { ...x, expect: v } : x)))}
                  />
                  <ResultBadge result={result} unchecked={unchecked} />
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`Brand ${brand} remove test ${i + 1}`}
                    onClick={() => onChange(tests.filter((_, j) => j !== i))}
                  >
                    Remove
                  </Button>
                </div>
              </div>
              {result && <MatchExplanation result={result} />}
            </li>
          );
        })}
      </ul>
      <div className="space-y-1.5">
        <Label htmlFor={`b${brand}-new-test`}>Add test sentence</Label>
        <Textarea
          id={`b${brand}-new-test`}
          aria-label={`Brand ${brand} new test sentence`}
          rows={2}
          maxLength={MAX_TEST_CHARS}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Paste a sentence from a real page"
          className="field-sizing-fixed resize-y"
        />
        <div className="flex flex-wrap items-center gap-2">
          <ExpectSelect aria-label={`Brand ${brand} new test expectation`} value={expect} onChange={setExpect} />
          <Button variant="outline" disabled={!text.trim() || full} onClick={add}>Add</Button>
          {full && <span className="text-xs text-neutral-500">At most {MAX_TESTS} test sentences per brand.</span>}
        </div>
      </div>
    </section>
  );
}
