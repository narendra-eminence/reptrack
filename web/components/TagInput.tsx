"use client";

import { type ReactNode, useState } from "react";
import { Label } from "@/components/ui/label";
import { addValues, splitEntries } from "@/lib/brandProfile";

export function TagInput({
  id, label, ariaLabel, values, onChange, placeholder, hint, children,
}: {
  id: string;
  label: string;
  ariaLabel?: string;
  values: string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
  hint?: ReactNode;
  children?: ReactNode;
}) {
  const [text, setText] = useState("");

  function commit(raw: string) {
    const entries = splitEntries(raw);
    if (entries.length) onChange(addValues(values, entries));
    setText("");
  }

  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex min-h-9 flex-wrap items-center gap-1.5 rounded-lg border border-input px-2 py-1 focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50">
        {values.map((v) => (
          <span key={v} className="inline-flex max-w-full items-center gap-1 rounded-md bg-neutral-100 py-0.5 pr-1 pl-2 text-sm">
            <span className="truncate">{v}</span>
            <button
              type="button"
              aria-label={`Remove ${v}`}
              onClick={() => onChange(values.filter((x) => x !== v))}
              className="rounded px-1 text-neutral-500 hover:bg-neutral-200 hover:text-neutral-900"
            >
              ×
            </button>
          </span>
        ))}
        <input
          id={id}
          aria-label={ariaLabel ?? label}
          value={text}
          placeholder={values.length ? undefined : placeholder}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              commit(text);
            } else if (e.key === "Backspace" && !text && values.length) {
              onChange(values.slice(0, -1));
            }
          }}
          onPaste={(e) => {
            const pasted = e.clipboardData.getData("text");
            if (/[\n,]/.test(pasted)) {
              e.preventDefault();
              commit(text + pasted);
            }
          }}
          onBlur={() => commit(text)}
          className="min-w-32 flex-1 bg-transparent py-1 text-sm outline-none placeholder:text-neutral-400"
        />
      </div>
      {hint && <p className="text-xs text-neutral-500">{hint}</p>}
      {children}
    </div>
  );
}
