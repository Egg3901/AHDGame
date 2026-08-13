import type { StatusBarLayout } from "./useStatusBarLayout";

/**
 * Stacking order for the fixed bottom StatusBar.
 *
 * Must stay BELOW the `z-50` used by modal overlays (`fixed inset-0 z-50`). At an
 * equal z-index the later DOM node wins, and the root layout renders StatusBar
 * after {children}, so a z-50 bar painted over the bottom of every modal. On a
 * phone that put tall forms' action rows under the bar with no way to reach them,
 * since the bar is fixed and does not scroll away (ticket-1061).
 */
export const STATUS_BAR_Z_INDEX_CLASS = "z-40";

/** Overlay stacking level used by modal dialogs; StatusBar must sit under it. */
export const MODAL_OVERLAY_Z_INDEX_CLASS = "z-50";

/** Container for the fixed bottom StatusBar. */
export const STATUS_BAR_CONTAINER_CLASS =
  `fixed bottom-0 left-0 right-0 ${STATUS_BAR_Z_INDEX_CLASS} border-t border-card-border/80 bg-card/85 backdrop-blur-xl pb-[env(safe-area-inset-bottom)] transition-opacity duration-150`;

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
