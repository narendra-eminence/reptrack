"use client";

import { useEffect, useState } from "react";
import { fmtElapsed } from "@/lib/format";

export function Elapsed({ since, until }: { since: string; until?: string | null }) {
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (until) return;
    const t = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(t);
  }, [until]);
  const end = until ? new Date(until).getTime() : nowMs;
  return <span className="tabular-nums">{fmtElapsed(end - new Date(since).getTime())}</span>;
}
