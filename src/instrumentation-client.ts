// Client-side Sentry (App Router). Next resolves src/instrumentation-client before the root file.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/
//
// The browser SDK is intentionally NOT statically imported here. A static
// `@sentry/nextjs` import lands ~450KB in the shared rootMain shell for every
// page — including the anonymous marketing landing page. Instead we dynamic-
// import the init module:
//   - Marketing / auth-entry paths: defer until after load + idle so LCP/FCP
//     are not competing with SDK parse/compile.
//   - All other (logged-in app) paths: start the dynamic import immediately so
//     hydration/render error coverage begins as soon as the async chunk loads.
// Early hydration errors on deferred routes can be missed; that tradeoff is
// deliberate for anonymous marketing traffic. App routes keep eager load.

type RouterTransitionStart = (...args: unknown[]) => void;

let captureRouterTransitionStartImpl: RouterTransitionStart = () => {};
let initStarted = false;

/**
 * Paths where we defer Sentry until after first paint / idle.
 * Keep this list to anonymous marketing + auth entry points only — anything
 * with a signed-in shell should init ASAP.
 */
function shouldDeferSentryInit(pathname: string): boolean {
  if (pathname === "/" || pathname === "") return true;
  const deferred = [
    "/login",
    "/register",
    "/about",
    "/contact",
    "/privacy",
    "/terms",
    "/faq",
    "/changelog",
    "/guides",
    "/banned",
    "/maintenance",
    "/supporters",
  ];
  return deferred.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

function startSentryInit(): void {
  if (initStarted) return;
  initStarted = true;

  void import("@/lib/observability/initSentryClient")
    .then(({ initSentryClient }) => {
      captureRouterTransitionStartImpl = initSentryClient() as RouterTransitionStart;
    })
    .catch(() => {
      // SDK failed to load — leave transition capture as no-op.
    });
}

function scheduleDeferredInit(): void {
  const run = () => startSentryInit();

  const idleWindow = window as Window & {
    requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
  };

  if (typeof idleWindow.requestIdleCallback === "function") {
    idleWindow.requestIdleCallback(run, { timeout: 4000 });
    return;
  }

  // Safari / older browsers: idle after load + a short settle delay.
  window.setTimeout(run, 2500);
}

function bootSentry(): void {
  const pathname = window.location.pathname;

  if (!shouldDeferSentryInit(pathname)) {
    startSentryInit();
    return;
  }

  // Defer until the load event so we do not compete with LCP resources, then
  // idle-callback (with timeout) so the SDK still arrives for later interactions.
  if (document.readyState === "complete") {
    scheduleDeferredInit();
  } else {
    window.addEventListener("load", scheduleDeferredInit, { once: true });
  }

  // If the visitor interacts before idle fires, load immediately so any
  // subsequent client error from that interaction is reportable.
  const onInteract = () => {
    startSentryInit();
  };
  for (const evt of ["pointerdown", "keydown", "touchstart"] as const) {
    window.addEventListener(evt, onInteract, { once: true, passive: true });
  }
}

if (typeof window !== "undefined") {
  bootSentry();
}

export const onRouterTransitionStart: RouterTransitionStart = (...args) => {
  captureRouterTransitionStartImpl(...args);
};
