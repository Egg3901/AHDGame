import { useEffect, type RefObject } from "react";

/** CSS custom property holding the fixed StatusBar's rendered height in px. */
export const STATUS_BAR_HEIGHT_VAR = "--status-bar-height";

/**
 * Publish the fixed bottom StatusBar's real height as a CSS variable on <html>
 * so the page can reserve exactly that much space under its last element.
 *
 * The bar is `position: fixed`, so it takes no room in the flow. A flat
 * `pb-14` (56px) on <main> covers it on desktop, but on a phone in portrait
 * the bar wraps to two rows and adds the home-indicator safe area, roughly
 * doubling its height. Pages with no footer (the admin and mod panels) then
 * ended with their last row, such as the Next page control, permanently
 * under the bar with no way to scroll it into view.
 */
export function useStatusBarHeightVar(ref: RefObject<HTMLElement | null>, active: boolean): void {
  useEffect(() => {
    const root = typeof document !== "undefined" ? document.documentElement : null;
    if (!root) return;
    const el = ref.current;
    if (!active || !el) {
      root.style.removeProperty(STATUS_BAR_HEIGHT_VAR);
      return;
    }
    const publish = () => {
      root.style.setProperty(
        STATUS_BAR_HEIGHT_VAR,
        `${Math.ceil(el.getBoundingClientRect().height)}px`
      );
    };
    publish();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", publish);
      return () => {
        window.removeEventListener("resize", publish);
        root.style.removeProperty(STATUS_BAR_HEIGHT_VAR);
      };
    }
    const observer = new ResizeObserver(publish);
    observer.observe(el);
    return () => {
      observer.disconnect();
      root.style.removeProperty(STATUS_BAR_HEIGHT_VAR);
    };
  }, [ref, active]);
}
