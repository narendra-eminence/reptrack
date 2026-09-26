"use client";

import { useEffect, useRef, useState } from "react";
import { api, errorMessage } from "./api";
import type { Plan, SearchInput } from "./types";

export function usePlan(input: SearchInput) {
  const [plan, setPlan] = useState<Plan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const seq = useRef(0);
  const empty = !input.queries.trim();

  useEffect(() => {
    const mine = ++seq.current; // any later edit makes this request stale
    if (empty) return;
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const p = await api.plan(input);
        if (mine === seq.current) {
          setPlan(p);
          setError(null);
        }
      } catch (e) {
        if (mine === seq.current) {
          setPlan(null);
          setError(errorMessage(e));
        }
      } finally {
        if (mine === seq.current) setLoading(false);
      }
    }, 400);
    return () => clearTimeout(t);
  }, [input, empty]);

  return empty ? { plan: null, error: null, loading: false } : { plan, error, loading };
}
