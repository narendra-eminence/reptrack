// Bridges a step navigation's document.startViewTransition callback with the shell layout's own effect: the
// callback needs a promise that resolves only after the new route has actually committed and rendered, otherwise
// the browser captures its "after" snapshot too early and the animation plays against the old page twice.
//
// Two failure modes this guards against:
// - A push that never changes the pathname (blocked navigation, or a target the caller should have skipped the
//   transition for entirely) would otherwise wait forever - a timeout resolves it regardless.
// - A second navigation started before the first settled would otherwise orphan the first promise forever; a
//   new call immediately resolves whatever call is still pending before creating its own.
const SETTLE_TIMEOUT_MS = 1000;

let pending: { resolve: () => void; timer: ReturnType<typeof setTimeout> } | null = null;

export function waitForRouteSettle(): Promise<void> {
  if (pending) {
    clearTimeout(pending.timer);
    pending.resolve();
    pending = null;
  }
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      if (pending?.resolve === finish) pending = null;
      resolve();
    };
    const timer = setTimeout(finish, SETTLE_TIMEOUT_MS);
    pending = { resolve: finish, timer };
  });
}

/** Called from an effect in the shell layout whenever the pathname changes (i.e. the new step has rendered). */
export function settleRoute(): void {
  if (pending) {
    clearTimeout(pending.timer);
    const resolve = pending.resolve;
    pending = null;
    resolve();
  }
}

// A navigation started while an earlier one's transition is still finishing (e.g. two quick stepper clicks)
// must not let the earlier one's cleanup (clearing data-step-direction once ITS transition.finished settles)
// run after the later one has already set its own direction - that would strip the attribute mid-animation and
// the later transition would fall back to the browser's default cross-fade. Each navigate() call claims a
// token; it may only act on document.documentElement.dataset.stepDirection while it still holds the latest one.
let navToken = 0;

export function beginNavigation(): number {
  navToken += 1;
  return navToken;
}

export function isCurrentNavigation(token: number): boolean {
  return token === navToken;
}
