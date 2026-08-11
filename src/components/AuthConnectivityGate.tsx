"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { useAuthMe } from "@/contexts/AuthDataContext";

function copyForError(kind: "rate_limited" | "unavailable" | "network") {
  if (kind === "rate_limited") {
    return {
      code: "429",
      headline: "Whoa, Slow Down",
      flavor: "You are sending requests faster than the clerk's office can stamp them.",
      subtext: "Wait a bit and try again. This is not a sign-out; your session is probably fine.",
    };
  }
  if (kind === "network") {
    return {
      code: "NET",
      headline: "Connection Lost",
      flavor: "Your dispatch got lost in committee.",
      subtext: "Check your connection. We could not reach the server to verify your session.",
    };
  }
  return {
    code: "503",
    headline: "Service Hiccup",
    flavor: "The chamber is temporarily out of order.",
    subtext: "Our servers are having trouble. Please try again in a moment.",
  };
}

/**
 * When /api/auth/me fails with a transient error, we keep the last known user object
 * so the app does not pretend you logged out. This gate surfaces that state:
 * - Full-screen card when we cannot establish whether anyone is signed in.
 * - Slim banner when we still have a cached user but refresh failed.
 */
export function AuthConnectivityGate() {
  const pathname = usePathname();
  const { user, loading, authFetchError, refetch } = useAuthMe();
  const prevPathRef = useRef(pathname);

  useEffect(() => {
    if (prevPathRef.current === pathname) return;
    prevPathRef.current = pathname;
    if (authFetchError !== "none") {
      refetch(false);
    }
  }, [pathname, authFetchError, refetch]);

  if (loading || authFetchError === "none") return null;

  const copy = copyForError(authFetchError);
  const onRetry = () => {
    void refetch(true);
  };

  if (user) {
    return (
      <div
        role="alert"
        className="border-b border-amber-500/40 bg-amber-500/10 px-4 py-2.5 text-center text-sm text-foreground"
      >
        <span className="font-medium">{copy.headline}.</span>{" "}
        <span className="text-muted">{copy.subtext}</span>{" "}
        <button
          type="button"
          onClick={onRetry}
          className="ml-2 inline font-semibold text-primary underline-offset-2 hover:underline"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center overflow-y-auto bg-background px-6 py-12">
      <div className="max-w-2xl w-full">
        <div className="rounded-xl border border-card-border bg-card p-8 sm:p-10 text-center space-y-6">
          <div className="space-y-2">
            <div className="flex items-center justify-center gap-3">
              <div className="h-px flex-1 bg-card-border" />
              <span className="text-5xl sm:text-6xl font-black tabular-nums text-foreground">
                {copy.code}
              </span>
              <div className="h-px flex-1 bg-card-border" />
            </div>
            <h1 className="text-xl sm:text-2xl font-bold text-foreground">{copy.headline}</h1>
          </div>
          <div className="space-y-2">
            <p className="text-sm text-muted max-w-md mx-auto font-medium">{copy.flavor}</p>
            <p className="text-xs text-muted/80 max-w-md mx-auto">{copy.subtext}</p>
          </div>
          <div className="flex flex-col sm:flex-row gap-3 justify-center pt-2">
            <button
              type="button"
              onClick={onRetry}
              className="rounded-lg bg-primary px-6 py-2.5 text-sm font-semibold text-white hover:bg-primary/90 transition-colors"
            >
              Try again
            </button>
            <Link
              href="/"
              className="rounded-lg border border-card-border bg-card-elevated px-6 py-2.5 text-sm font-semibold text-foreground hover:bg-background transition-colors"
            >
              Return home
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
