"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { useRunContext } from "@/lib/RunContext";
import { landingStep } from "@/lib/steps";

// Deterministic landing redirect, evaluated from persisted run data (never from anything in the URL):
// a done verification -> /done, else any persisted SERP results -> /verify, else -> /search.
export default function RunIndexPage() {
  const { run } = useRunContext();
  const router = useRouter();
  // Fires once: a later SSE update changing landingStep's answer (e.g. results arriving) must not re-trigger
  // the redirect out from under whatever page the first replace already landed on.
  const redirected = useRef(false);

  useEffect(() => {
    if (redirected.current) return;
    redirected.current = true;
    router.replace(`/runs/${run.id}/${landingStep(run)}`);
  }, [run, router]);

  return null;
}
