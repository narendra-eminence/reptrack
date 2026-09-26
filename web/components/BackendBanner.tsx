"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { Health } from "@/lib/types";

export function BackendBanner() {
  const [health, setHealth] = useState<Health | null>(null);
  const [down, setDown] = useState(false);

  useEffect(() => {
    let alive = true;
    const check = async () => {
      try {
        const h = await api.health();
        if (alive) {
          setHealth(h);
          setDown(false);
        }
      } catch {
        if (alive) setDown(true);
      }
    };
    void check();
    const t = setInterval(check, 10_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  if (down) {
    return (
      <Banner tone="error" title="Backend not reachable">
        The API at 127.0.0.1:8000 is not responding. Start it with <code>make dev</code> in the repscore-pipeline folder.
      </Banner>
    );
  }
  if (!health) return null;
  const problems: string[] = [];
  if (health.verifier_config_error) problems.push(`Verifier config: ${health.verifier_config_error}`);
  if (!health.chromium) problems.push("Chromium for the verifier is not installed. Run `uv run playwright install chromium` in url-verification.");
  for (const [provider, message] of Object.entries(health.keys)) {
    if (message) problems.push(`${provider === "serpapi" ? "SerpAPI" : "DataForSEO"}: ${message}`);
  }
  if (!problems.length) return null;
  return (
    <Banner tone="warning" title="Setup needs attention">
      <ul className="list-disc pl-5">
        {problems.map((p) => (
          <li key={p}>{p}</li>
        ))}
      </ul>
    </Banner>
  );
}

function Banner({ tone, title, children }: { tone: "error" | "warning"; title: string; children: React.ReactNode }) {
  return (
    <div role="alert" className={tone === "error" ? "border-b border-red-200 bg-red-50" : "border-b border-amber-200 bg-amber-50"}>
      <div className="mx-auto max-w-[1440px] px-6 py-3 text-sm">
        <p className="font-semibold">{title}</p>
        <div className="mt-1 text-neutral-700">{children}</div>
      </div>
    </div>
  );
}
