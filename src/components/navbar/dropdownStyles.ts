/** Viewport-capped scrollable dropdown panel (desktop popovers). */
export const DROPDOWN_PANEL_CLASS =
  "max-h-[min(32rem,calc(100dvh-5.5rem-env(safe-area-inset-top,0px)-env(safe-area-inset-bottom,0px)))] overflow-y-auto overscroll-contain overflow-x-hidden max-w-[calc(100vw-1rem)]";

/** Viewport-capped scrollable mobile hamburger menu panel. */
export const MOBILE_MENU_PANEL_CLASS =
  "max-h-[calc(100dvh-4rem-env(safe-area-inset-top,0px)-env(safe-area-inset-bottom,0px))] overflow-y-auto overscroll-contain";

/** Notification preview list inside a dropdown. */
export const NOTIFICATION_LIST_CLASS =
  "max-h-[calc(100dvh-8rem-env(safe-area-inset-bottom,0px))] overflow-y-auto";
