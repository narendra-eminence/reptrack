"use client";

import { usePathname, useRouter } from "next/navigation";
import { useCallback } from "react";
import { STEP_ORDER, currentStepFromPath } from "./steps";
import { waitForRouteSettle } from "./routeTransition";

/** Navigates between step routes, sliding the step-panel view transition left for a forward step and right for
 * a backward one. Falls back to an instant `router.push` when the View Transition API is unavailable or the
 * user prefers reduced motion; Back/Forward browser navigation is never wrapped (accepted per the brief). */
export function useStepNavigation() {
  const router = useRouter();
  const pathname = usePathname();

  return useCallback(
    (href: string) => {
      const from = currentStepFromPath(pathname);
      const to = currentStepFromPath(href);
      const direction =
        from && to && from !== to ? (STEP_ORDER.indexOf(to) > STEP_ORDER.indexOf(from) ? "forward" : "back") : "forward";

      const reducedMotion = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (reducedMotion || typeof document.startViewTransition !== "function") {
        router.push(href);
        return;
      }

      document.documentElement.dataset.stepDirection = direction;
      document.startViewTransition(() => {
        router.push(href);
        return waitForRouteSettle();
      });
    },
    [pathname, router],
  );
}
