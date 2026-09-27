// Bridges a step navigation's document.startViewTransition callback with the shell layout's own effect: the
// callback needs a promise that resolves only after the new route has actually committed and rendered, otherwise
// the browser captures its "after" snapshot too early and the animation plays against the old page twice.
let pendingResolve: (() => void) | null = null;

export function waitForRouteSettle(): Promise<void> {
  return new Promise((resolve) => {
    pendingResolve = resolve;
  });
}

/** Called from an effect in the shell layout whenever the pathname changes (i.e. the new step has rendered). */
export function settleRoute(): void {
  if (pendingResolve) {
    const resolve = pendingResolve;
    pendingResolve = null;
    resolve();
  }
}
