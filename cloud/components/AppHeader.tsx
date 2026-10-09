"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/api";
import type { Me } from "@/lib/types";

export function AppHeader({ me }: { me: Me }) {
  const path = usePathname();
  const [signingOut, setSigningOut] = useState(false);
  const nav = [{ href: "/", label: "Runs" }, ...(me.role === "admin" ? [{ href: "/admin/users", label: "Users" }] : [])];

  async function signOut() {
    setSigningOut(true);
    try {
      await api.logout();
    } finally {
      // A full page load on purpose: the server layout must re-render without the old session.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.assign("/login");
    }
  }

  return (
    <header className="border-b border-neutral-200 bg-white">
      <div className="mx-auto flex h-14 max-w-[1440px] items-center gap-8 px-6">
        <Link href="/" className="font-heading text-lg text-brand-navy">
          RepScore Search
        </Link>
        <nav className="flex gap-6 text-sm">
          {nav.map((n) => {
            const active = n.href === "/" ? path === "/" || path.startsWith("/runs") : path.startsWith(n.href);
            return (
              <Link
                key={n.href}
                href={n.href}
                aria-current={active ? "page" : undefined}
                className={active ? "font-semibold text-brand-red" : "text-neutral-600 hover:text-neutral-900"}
              >
                {n.label}
              </Link>
            );
          })}
        </nav>
        <div className="ml-auto flex items-center gap-4 text-sm">
          <Link href="/account" data-testid="account-link" className={path === "/account" ? "font-semibold text-brand-red" : "text-neutral-600 hover:text-neutral-900"}>
            {me.email}
          </Link>
          <button type="button" onClick={signOut} disabled={signingOut} className="text-neutral-600 hover:text-neutral-900 disabled:opacity-50">
            Sign out
          </button>
        </div>
      </div>
    </header>
  );
}
