"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useRunContext } from "@/lib/RunContext";
import { landingStep } from "@/lib/steps";

// Deterministic landing redirect, evaluated from persisted run data (never from anything in the URL):
// a done verification -> /done, else any persisted SERP results -> /verify, else -> /search.
export default function RunIndexPage() {
  const { run } = useRunContext();
  const router = useRouter();

  useEffect(() => {
    router.replace(`/runs/${run.id}/${landingStep(run)}`);
  }, [run, router]);

  return null;
}
