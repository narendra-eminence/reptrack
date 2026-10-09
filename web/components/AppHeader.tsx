"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV = [
  { href: "/", label: "Runs" },
  { href: "/brands", label: "Brands" },
];

export function AppHeader() {
  const path = usePathname();
  return (
    <header className="border-b border-neutral-200 bg-white">
      <div className="mx-auto flex h-14 max-w-[1440px] items-center gap-8 px-6">
        <Link href="/" className="font-heading text-lg text-brand-navy">
          RepScore Pipeline
        </Link>
        <nav className="flex gap-6 text-sm">
          {NAV.map((n) => {
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
      </div>
    </header>
  );
}
