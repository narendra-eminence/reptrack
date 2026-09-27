"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { RunDetail } from "./types";

export interface RunContextValue {
  run: RunDetail;
  refetch: () => Promise<void>;
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
