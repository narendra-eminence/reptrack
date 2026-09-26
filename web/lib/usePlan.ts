"use client";

import { useEffect, useRef, useState } from "react";
import { api, errorMessage } from "./api";
import type { Plan, SearchInput } from "./types";

export function usePlan(input: SearchInput) {
  const [plan, setPlan] = useState<Plan | null>(null);
  const [planFor, setPlanFor] = useState<SearchInput | null>(null); // the input the current `plan` was computed for
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
          setPlanFor(input);
          setError(null);
        }
      } catch (e) {
        if (mine === seq.current) {
          setPlan(null);
          setPlanFor(null);
          setError(errorMessage(e));
        }
      } finally {
        if (mine === seq.current) setLoading(false);
      }
    }, 400);
    return () => clearTimeout(t);
  }, [input, empty]);

  // Stale means the last plan does not describe the current input - up to 400ms of debounce plus the request's
  // own round trip after any edit, during which "Run search" must not stay enabled for the previous plan.
  const stale = plan !== null && JSON.stringify(planFor) !== JSON.stringify(input);

  return empty ? { plan: null, error: null, loading: false, stale: false } : { plan, error, loading, stale };
}
