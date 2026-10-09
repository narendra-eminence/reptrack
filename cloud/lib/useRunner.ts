"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, errorMessage } from "./api";

/** Steps in flight at once from this tab. SerpAPI plans allow 5 or more concurrent searches; 4 leaves headroom. */
export const CONCURRENCY = 4;
const MAX_CONSECUTIVE_ERRORS = 3;

/**
 * Drives a run from this tab: several workers each ask the server to search the next query until none is left.
 * Every finished query is already saved in Supabase, so closing the tab only pauses the run; opening it again
 * picks up where it stopped. onProgress is called after every finished query.
 */
export function useRunner(runId: string, onProgress: () => void) {
  const [driving, setDriving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const stopRef = useRef(false);
  const runningRef = useRef(false);
  const progressRef = useRef(onProgress);
  useEffect(() => {
    progressRef.current = onProgress;
  }, [onProgress]);

  const start = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    stopRef.current = false;
    setDriving(true);
    setError(null);
    const worker = async () => {
      let errors = 0;
      while (!stopRef.current) {
        try {
          const { step } = await api.step(runId);
          errors = 0;
          if (!step) return;
          progressRef.current();
        } catch (e) {
          errors++;
          if (errors >= MAX_CONSECUTIVE_ERRORS) {
            setError(`Searching paused: ${errorMessage(e)}`);
            stopRef.current = true;
            return;
          }
          await new Promise((r) => setTimeout(r, 3000 * errors));
        }
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    runningRef.current = false;
    setDriving(false);
    progressRef.current();
  }, [runId]);

  const stop = useCallback(() => {
    stopRef.current = true;
  }, []);

  // Leaving while this tab drives the run pauses it; say so before the tab closes.
  useEffect(() => {
    if (!driving) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [driving]);

  useEffect(() => () => stop(), [stop]);

  return { driving, error, start, stop };
}
