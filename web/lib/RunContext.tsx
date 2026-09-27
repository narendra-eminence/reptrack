"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { StepKey } from "./steps";
import type { RunDetail } from "./types";

export interface RunContextValue {
  run: RunDetail;
  refetch: () => Promise<void>;
  /** The last query string (without a leading "?") seen on that step's route during this session, so a step
   * navigation can restore it. Empty string if that step hasn't been visited yet, or was visited with no params. */
  getStepQuery: (step: StepKey) => string;
}

const RunContext = createContext<RunContextValue | null>(null);

export function RunProvider({ value, children }: { value: RunContextValue; children: ReactNode }) {
  return <RunContext.Provider value={value}>{children}</RunContext.Provider>;
}

export function useRunContext(): RunContextValue {
  const ctx = useContext(RunContext);
  if (!ctx) throw new Error("useRunContext must be used within the run shell layout");
  return ctx;
}
