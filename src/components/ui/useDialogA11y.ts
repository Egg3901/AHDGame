"use client";

import { useEffect, useId } from "react";

/**
 * The accessibility contract every overlay dialog owes, in one place.
 *
 * `MailComposerModal` and the shared `Modal` each hand-rolled this, and the
 * ~28 remaining hand-rolled overlays did not (#15). Returning the props rather
 * than a wrapper component keeps it usable by dialogs whose markup and styling
 * already differ, which is why they were not on `Modal` to begin with.
 *
 * Usage:
 *
 *   const { dialogProps, titleId } = useDialogA11y(onClose);
 *   <div className="fixed inset-0 …" {...dialogProps}>
 *     <h2 id={titleId}>Spin off a subsidiary</h2>
 *
 * `aria-labelledby` is the part that is easy to miss: without it a screen
 * reader announces "dialog" and nothing else, even when `role` and
 * `aria-modal` are both present.
 */
export function useDialogA11y(
  onClose: () => void,
  options: { closeOnEscape?: boolean } = {}
): {
  dialogProps: { role: "dialog"; "aria-modal": true; "aria-labelledby": string };
  titleId: string;
} {
  const titleId = useId();
  const closeOnEscape = options.closeOnEscape ?? true;

  useEffect(() => {
    if (!closeOnEscape) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [closeOnEscape, onClose]);

  return {
    dialogProps: { role: "dialog", "aria-modal": true, "aria-labelledby": titleId },
    titleId,
  };
}
