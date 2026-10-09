"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Clip } from "@/components/Clip";
import { Field } from "@/components/Field";
import { NativeSelect } from "@/components/NativeSelect";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, errorMessage } from "@/lib/api";
import { fmtDateTime } from "@/lib/format";
import type { Me, Role, UserRow } from "@/lib/types";

const MIN_PASSWORD = 10;

function CreateUserForm({ onCreated }: { onCreated: (u: UserRow) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>("member");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < MIN_PASSWORD) {
      setError(`The password needs at least ${MIN_PASSWORD} characters.`);
      return;
    }
    setBusy(true);
    try {
      const user = await api.createUser(email.trim(), password, role);
      onCreated(user);
      setEmail("");
      setPassword("");
      setRole("member");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4 rounded-md border p-5" aria-label="Add a user">
      <h2 className="text-lg">Add a user</h2>
      <div className="grid gap-4 md:grid-cols-[1fr_1fr_10rem_auto] md:items-start">
        <Field id="new-email" label="Email">
          <Input id="new-email" type="email" autoComplete="off" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field id="new-password" label="Password" hint={`At least ${MIN_PASSWORD} characters. Share it with them privately.`}>
          <Input id="new-password" type="text" autoComplete="new-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <Field id="new-role" label="Role">
          <NativeSelect id="new-role" value={role} onChange={(e) => setRole(e.target.value as Role)}>
            <option value="member">Member</option>
            <option value="admin">Admin</option>
          </NativeSelect>
        </Field>
        {/* An invisible label row keeps the button level with the inputs whatever the label's line height. */}
        <div className="space-y-1.5">
          <Label aria-hidden className="invisible max-md:hidden">Add</Label>
          <Button type="submit" disabled={busy}>{busy ? "Adding..." : "Add user"}</Button>
        </div>
      </div>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    </form>
  );
}

type Dialog = { kind: "password" | "delete"; user: UserRow } | null;

export function UsersAdmin({ me }: { me: Me }) {
  const [users, setUsers] = useState<UserRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [newPassword, setNewPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);

  const load = useCallback(() => {
    api.users().then(setUsers).catch((e) => setError(errorMessage(e)));
  }, []);
  useEffect(load, [load]);

  function open(kind: "password" | "delete", user: UserRow) {
    setDialog({ kind, user });
    setNewPassword("");
    setDialogError(null);
  }

  async function changeRole(user: UserRow, role: Role) {
    setError(null);
    setNotice(null);
    try {
      await api.updateUser(user.id, { role });
      setNotice(`${user.email} is now ${role === "admin" ? "an admin" : "a member"}.`);
    } catch (e) {
      setError(errorMessage(e));
    }
    load();
  }

  async function confirm() {
    if (!dialog) return;
    setDialogError(null);
    if (dialog.kind === "password" && newPassword.length < MIN_PASSWORD) {
      setDialogError(`The password needs at least ${MIN_PASSWORD} characters.`);
      return;
    }
    setBusy(true);
    try {
      if (dialog.kind === "password") {
        await api.updateUser(dialog.user.id, { password: newPassword });
        setNotice(`New password set for ${dialog.user.email}.`);
      } else {
        await api.deleteUser(dialog.user.id);
        setNotice(`${dialog.user.email} was removed.`);
      }
      setDialog(null);
      load();
    } catch (e) {
      setDialogError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl">Users</h1>
        <p className="mt-1 text-sm text-neutral-600">There is no sign-up: people get an account when an admin adds them here. Removing someone keeps the runs they started.</p>
      </div>
      <CreateUserForm
        onCreated={(u) => {
          setNotice(`${u.email} can now sign in.`);
          setError(null);
          load();
        }}
      />
      {notice && <p role="status" className="text-sm text-emerald-700">{notice}</p>}
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      {!users && !error && <p className="text-sm text-neutral-500">Loading...</p>}
      {users && (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full min-w-[960px] table-fixed text-sm">
            <colgroup>
              <col />
              <col className="w-36" />
              <col className="w-48" />
              <col className="w-48" />
              <col className="w-64" />
            </colgroup>
            <thead className="bg-neutral-50 text-left text-xs uppercase tracking-wide text-neutral-500">
              <tr>
                <th className="px-3 py-2">Email</th>
                <th className="px-3 py-2">Role</th>
                <th className="px-3 py-2">Added</th>
                <th className="px-3 py-2">Last sign-in</th>
                <th className="px-3 py-2"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const self = u.id === me.id;
                return (
                  <tr key={u.id} data-testid="user-row" className="border-t">
                    <td className="px-3 py-2">
                      <Clip text={self ? `${u.email} (you)` : u.email} />
                    </td>
                    <td className="px-3 py-1.5">
                      <NativeSelect
                        aria-label={`Role of ${u.email}`}
                        value={u.role}
                        disabled={self}
                        title={self ? "You cannot change your own role." : undefined}
                        onChange={(e) => void changeRole(u, e.target.value as Role)}
                      >
                        <option value="member">Member</option>
                        <option value="admin">Admin</option>
                      </NativeSelect>
                    </td>
                    <td className="px-3 py-2"><Clip text={fmtDateTime(u.created_at)} /></td>
                    <td className="px-3 py-2"><Clip text={u.last_sign_in_at ? fmtDateTime(u.last_sign_in_at) : "Never"} /></td>
                    <td className="px-3 py-1.5">
                      <div className="flex justify-end gap-2">
                        <Button variant="outline" size="sm" onClick={() => open("password", u)}>Set password</Button>
                        {!self && <Button variant="outline" size="sm" className="text-red-700" onClick={() => open("delete", u)}>Remove</Button>}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <AlertDialog open={!!dialog} onOpenChange={(o) => { if (!o && !busy) setDialog(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{dialog?.kind === "delete" ? `Remove ${dialog.user.email}?` : `New password for ${dialog?.user.email ?? ""}`}</AlertDialogTitle>
            <AlertDialogDescription>
              {dialog?.kind === "delete"
                ? "They can no longer sign in. The runs they started stay for everyone else. This cannot be undone."
                : "This signs them out everywhere; they sign in with the new password from then on. Tell them privately; they can change it on their account page."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {dialog?.kind === "password" && (
            <Field id="reset-password" label="New password" hint={`At least ${MIN_PASSWORD} characters.`}>
              <Input id="reset-password" type="text" autoComplete="new-password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
            </Field>
          )}
          {dialogError && <p role="alert" className="text-sm text-red-700">{dialogError}</p>}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={(e) => {
                e.preventDefault();
                void confirm();
              }}
            >
              {dialog?.kind === "delete" ? "Remove" : "Set password"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
