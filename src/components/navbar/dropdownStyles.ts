/** Viewport-capped scrollable dropdown panel (desktop popovers). */
export const DROPDOWN_PANEL_CLASS =
  "max-h-[min(32rem,calc(100dvh-5.5rem-env(safe-area-inset-top,0px)-env(safe-area-inset-bottom,0px)))] overflow-y-auto overscroll-contain overflow-x-hidden max-w-[calc(100vw-1rem)]";

/** Viewport-capped scrollable mobile hamburger menu panel. */
export const MOBILE_MENU_PANEL_CLASS =
  "max-h-[calc(100dvh-4rem-env(safe-area-inset-top,0px)-env(safe-area-inset-bottom,0px))] overflow-y-auto overscroll-contain";

/** Notification preview list inside a dropdown. */
export const NOTIFICATION_LIST_CLASS =
  "max-h-[calc(100dvh-8rem-env(safe-area-inset-bottom,0px))] overflow-y-auto";

/** Shared label for sections inside desktop dropdown panels. */
export const MENU_SECTION_LABEL_CLASS =
  "px-2.5 pb-1 pt-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted/70";

/** Shared hairline divider between sections inside desktop dropdown panels. */
export const MENU_DIVIDER_CLASS = "mx-2 my-1 border-t border-card-border/40";

/** Shared leading-icon treatment for desktop dropdown rows. */
export const MENU_ICON_CLASS = "h-4 w-4 shrink-0 text-muted";

/** Shared row shell for desktop dropdown rows (links and buttons). */
export const MENU_ROW_BASE_CLASS =
  "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors disabled:opacity-50";

/** Shared idle/active treatments for desktop dropdown rows. */
export const MENU_ROW_IDLE_CLASS = "text-muted hover:bg-background/60 hover:text-foreground";
export const MENU_ROW_ACTIVE_CLASS = "bg-primary/10 font-medium text-foreground";
