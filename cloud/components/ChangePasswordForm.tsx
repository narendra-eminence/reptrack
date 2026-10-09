"use client";

import { useState, type FormEvent } from "react";
import { Field } from "@/components/Field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api, errorMessage } from "@/lib/api";

const MIN_PASSWORD = 10;

export function ChangePasswordForm() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [repeat, setRepeat] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setDone(false);
    if (next.length < MIN_PASSWORD) return setError(`The new password needs at least ${MIN_PASSWORD} characters.`);
    if (next !== repeat) return setError("The two new passwords are different.");
    setBusy(true);
    try {
      await api.changePassword(current, next);
      setDone(true);
      setCurrent("");
      setNext("");
      setRepeat("");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4 rounded-md border p-6" aria-label="Change password">
      <h2 className="text-lg">Change password</h2>
      <p className="text-sm text-neutral-600">This also signs you out on every other device.</p>
      <Field id="current-password" label="Current password">
        <Input id="current-password" type="password" autoComplete="current-password" required value={current} onChange={(e) => setCurrent(e.target.value)} />
      </Field>
      <Field id="next-password" label="New password" hint={`At least ${MIN_PASSWORD} characters.`}>
        <Input id="next-password" type="password" autoComplete="new-password" required value={next} onChange={(e) => setNext(e.target.value)} />
      </Field>
      <Field id="repeat-password" label="New password again">
        <Input id="repeat-password" type="password" autoComplete="new-password" required value={repeat} onChange={(e) => setRepeat(e.target.value)} />
      </Field>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      {done && <p role="status" className="text-sm text-emerald-700">Password changed. Any other devices were signed out.</p>}
      <Button type="submit" disabled={busy}>{busy ? "Saving..." : "Change password"}</Button>
    </form>
  );
}
