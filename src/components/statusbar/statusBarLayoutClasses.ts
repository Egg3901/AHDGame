import type { StatusBarLayout } from "./useStatusBarLayout";

/**
 * Outer flex row for the StatusBar. Compact layouts (corp / elections) put the
 * online count at the end of the left cluster and Profile chips on the right;
 * without an explicit gap-x, `justify-between` collapses to flush contact once
 * the row is full — which command-1953's wider monospace hits sooner.
 */
export function statusBarRowClassName(layout: StatusBarLayout): string {
  if (layout === "minimal") {
    return "justify-center gap-3 sm:gap-5 min-h-11";
  }
  if (layout === "full") {
    return "flex-wrap justify-center gap-x-6 gap-y-2 min-h-11 sm:py-0";
  }
  return "flex-wrap justify-between gap-x-3 gap-y-2 min-h-11 sm:gap-x-4 sm:py-0";
}
