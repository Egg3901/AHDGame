// Generic click-outside / Escape close hook.
//
// Used by dropdowns, popovers, and modals to close themselves when the user
// interacts somewhere else. Replaces the inline mousedown / keydown wiring
// that several components (Navbar, MobileSelect, SharePurchaseModal) had
// duplicated.
//
// Defaults match the most common case (mousedown, no Escape close). The
// `eventType: "click"` option matches the rarer pattern where a button inside
// the dropdown should toggle the dropdown closed via its own onClick handler
// before the document-level handler fires (mousedown would race the toggle).

import { useEffect } from "react";
import type { RefObject } from "react";

export interface UseClickOutsideOptions {
  /**
   * Document-level event to listen for. Default `"mousedown"`. Use `"click"`
   * when a button inside the popped element handles its own close — `click`
   * fires after the button's own handler so the toggle behavior wins.
   */
  eventType?: "mousedown" | "click";
  /** Also close on Escape keydown. Default false. */
  closeOnEscape?: boolean;
}

export function useClickOutside<T extends HTMLElement>(
  ref: RefObject<T | null>,
  isActive: boolean,
  onClose: () => void,
  opts: UseClickOutsideOptions = {}
): void {
  const eventType = opts.eventType ?? "mousedown";
  const closeOnEscape = opts.closeOnEscape ?? false;

  useEffect(() => {
    if (!isActive) return;

    const handlePointer = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKeyDown = closeOnEscape
      ? (e: KeyboardEvent) => {
          if (e.key === "Escape") onClose();
        }
      : null;

    document.addEventListener(eventType, handlePointer);
    if (handleKeyDown) document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener(eventType, handlePointer);
      if (handleKeyDown) document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isActive, ref, onClose, eventType, closeOnEscape]);
}
