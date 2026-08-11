"use client";

import { useState, useRef, useEffect } from "react";

interface TooltipProps {
  content: React.ReactNode;
  children: React.ReactNode;
  /** Which side to prefer. Defaults to "top". */
  side?: "top" | "bottom" | "left" | "right";
  maxWidth?: number;
}

/**
 * Hover tooltip that auto-flips if it would overflow the viewport.
 * Also supports touch/tap: tapping shows the tooltip near the touch point
 * and it auto-hides after 2.5 seconds.
 *
 * Usage:
 *   <Tooltip content={<>...</>}><button>hover me</button></Tooltip>
 */
export function Tooltip({ content, children, side = "top", maxWidth = 280 }: TooltipProps) {
  const [visible, setVisible] = useState(false);
  const [touchPoint, setTouchPoint] = useState<{ x: number; y: number } | null>(null);
  // Start off-screen to avoid a one-frame flash at an uncomputed position.
  const [pos, setPos] = useState({ top: "-9999px", left: "-9999px" });
  const wrapRef = useRef<HTMLDivElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!visible || !wrapRef.current || !tipRef.current) return;

    const computeAndSet = (tp: { x: number; y: number } | null) => {
      if (!wrapRef.current || !tipRef.current) return;
      const anchor = wrapRef.current.getBoundingClientRect();
      const tip = tipRef.current.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const M = 8; // minimum margin from every viewport edge
      const GAP = 8;

      // Anchor point: use touch coordinates when tap-triggered, otherwise element bounds.
      const anchorTop = tp ? tp.y : anchor.top;
      const anchorBottom = tp ? tp.y : anchor.bottom;
      const anchorCenterX = tp ? tp.x : anchor.left + anchor.width / 2;
      const anchorCenterY = tp ? tp.y : anchor.top + anchor.height / 2;

      const spaceAbove = anchorTop;
      const spaceBelow = vh - anchorBottom;

      const resolvedSide =
        side === "top" && spaceAbove < tip.height + GAP && spaceBelow > spaceAbove
          ? "bottom"
          : side === "bottom" && spaceBelow < tip.height + GAP && spaceAbove > spaceBelow
            ? "top"
            : side;

      // Compute exact pixel top-left corner of the tooltip (no CSS transforms).
      // Then clamp BOTH axes so the tooltip always stays inside the viewport.
      let top: number;
      let left: number;

      if (resolvedSide === "top") {
        top = anchorTop - tip.height - GAP;
        left = anchorCenterX - tip.width / 2;
      } else if (resolvedSide === "bottom") {
        top = anchorBottom + GAP;
        left = anchorCenterX - tip.width / 2;
      } else if (resolvedSide === "left") {
        top = anchorCenterY - tip.height / 2;
        left = anchor.left - tip.width - GAP;
      } else {
        // right
        top = anchorCenterY - tip.height / 2;
        left = anchor.right + GAP;
      }

      // Clamp both axes — this is what prevents escaping the screen on mobile.
      left = Math.max(M, Math.min(vw - tip.width - M, left));
      top = Math.max(M, Math.min(vh - tip.height - M, top));

      setPos({ top: `${top}px`, left: `${left}px` });
    };

    // Initial placement — use the touch point when tap-triggered.
    computeAndSet(touchPoint);

    // On scroll/resize, recompute using element bounds so the tooltip
    // tracks its anchor rather than staying stuck at the original position.
    const onScroll = () => computeAndSet(null);
    window.addEventListener("scroll", onScroll, { passive: true, capture: true });
    window.addEventListener("resize", onScroll, { passive: true });

    return () => {
      window.removeEventListener("scroll", onScroll, { capture: true });
      window.removeEventListener("resize", onScroll);
    };
  }, [visible, side, touchPoint]);

  const handleTouchStart = (e: React.TouchEvent) => {
    const touch = e.touches[0];
    setTouchPoint({ x: touch.clientX, y: touch.clientY });
    setVisible(true);

    // Auto-hide after 2.5 s on touch (no mouseleave available).
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => {
      setVisible(false);
      setTouchPoint(null);
    }, 2500);
  };

  return (
    <>
      <div
        ref={wrapRef}
        className="inline-flex"
        onMouseEnter={() => setVisible(true)}
        onMouseLeave={() => {
          setVisible(false);
          setTouchPoint(null);
        }}
        onFocus={() => setVisible(true)}
        onBlur={() => setVisible(false)}
        onTouchStart={handleTouchStart}
      >
        {children}
      </div>

      {visible && (
        <div
          ref={tipRef}
          role="tooltip"
          className="fixed z-[9999] pointer-events-none"
          style={{ top: pos.top, left: pos.left, maxWidth }}
        >
          <div className="rounded-lg border border-card-border bg-card px-3 py-2.5 text-xs text-foreground shadow-modal shadow-black/30 leading-relaxed">
            {content}
          </div>
        </div>
      )}
    </>
  );
}
