"use client";

import { useLayoutEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";

const WIDTH_PX: Record<string, number> = {
  "w-[220px]": 220,
  "w-[240px]": 240,
  "w-[250px]": 250,
  "w-[300px]": 300,
  "w-60": 240,
};

function resolvePanelWidth(widthClass: string): number {
  return WIDTH_PX[widthClass] ?? 250;
}

export interface AnchoredDropdownPanelProps {
  anchorRef: RefObject<HTMLElement | null>;
  panelRef?: RefObject<HTMLDivElement | null>;
  open?: boolean;
  align: "left" | "right";
  width?: string;
  padded?: boolean;
  children: React.ReactNode;
}

/**
 * Fixed-position dropdown portaled to document.body so navbar overflow
 * containers cannot clip it. Computes max-height from remaining viewport space.
 */
export function AnchoredDropdownPanel({
  anchorRef,
  panelRef,
  open = true,
  align,
  width = "w-[250px]",
  padded = true,
  children,
}: AnchoredDropdownPanelProps) {
  const [mounted] = useState(() => typeof document !== "undefined");
  const [position, setPosition] = useState<{ top: number; left: number; maxHeight: number } | null>(
    null
  );
  const internalPanelRef = useRef<HTMLDivElement>(null);
  const resolvedPanelRef = panelRef ?? internalPanelRef;

  useLayoutEffect(() => {
    if (!open) {
      /* eslint-disable react-hooks/set-state-in-effect -- reset position when the panel closes */
      setPosition(null);
      /* eslint-enable react-hooks/set-state-in-effect */
      return;
    }

    let raf = 0;
    const updatePosition = () => {
      const anchor = anchorRef.current;
      // The anchor's `ref` is attached to the trigger element, which is the
      // *parent* of this portaled panel. React commits a parent's ref only
      // after its children's layout effects run, so on the first open pass
      // `anchorRef.current` is still null — retry on the next frame instead of
      // giving up (which left the dropdown permanently unpositioned/invisible).
      if (!anchor) {
        raf = requestAnimationFrame(updatePosition);
        return;
      }

      const rect = anchor.getBoundingClientRect();
      const viewportPad = 8;
      const gap = 6;
      const panelWidth = resolvePanelWidth(width);
      const top = rect.bottom + gap;
      const maxHeight = Math.max(160, window.innerHeight - top - viewportPad);

      let left = align === "left" ? rect.left : rect.right - panelWidth;
      left = Math.max(viewportPad, Math.min(left, window.innerWidth - panelWidth - viewportPad));

      setPosition({ top, left, maxHeight });
    };

    updatePosition();

    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open, anchorRef, align, width]);

  if (!mounted || !open || !position) return null;

  return createPortal(
    <div
      ref={resolvedPanelRef}
      role="menu"
      data-nav-dropdown="true"
      style={{
        position: "fixed",
        top: position.top,
        left: position.left,
        width: resolvePanelWidth(width),
        maxHeight: position.maxHeight,
      }}
      className={`z-[70] ${padded ? "p-1.5" : ""} animate-[fadeIn_0.15s_ease_forwards] overflow-y-auto overscroll-contain overflow-x-hidden rounded-xl border border-card-border bg-card-elevated shadow-modal`}
    >
      {children}
    </div>,
    document.body
  );
}
