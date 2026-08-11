"use client";

import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";

interface InfoTooltipProps {
  /** The element that triggers the tooltip (info icon, badge, card, etc.) */
  trigger: React.ReactNode;
  /** Tooltip content */
  children: React.ReactNode;
  /** Preferred width in pixels (default 256) */
  width?: number;
  /** Extra class on the trigger wrapper */
  className?: string;
}

interface AnchorRect {
  top: number;
  bottom: number;
  left: number;
  right: number;
  width: number;
}

/**
 * Mobile-friendly tooltip using a portal.
 * - Desktop: shows on hover (mouseenter/mouseleave)
 * - Mobile: tap to open, tap trigger or outside to close
 */
export function InfoTooltip({ trigger, children, width = 256, className }: InfoTooltipProps) {
  const [anchor, setAnchor] = useState<AnchorRect | null>(null);
  const triggerRef = useRef<HTMLSpanElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [mounted] = useState(() => typeof window !== "undefined");

  function getRect(): AnchorRect | null {
    if (!triggerRef.current) return null;
    const r = triggerRef.current.getBoundingClientRect();
    return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width };
  }

  function open() {
    if (leaveTimer.current) clearTimeout(leaveTimer.current);
    const r = getRect();
    if (r) setAnchor(r);
  }

  function close(delay = 120) {
    leaveTimer.current = setTimeout(() => setAnchor(null), delay);
  }

  function handleMouseEnter() {
    open();
  }

  function handleMouseLeave() {
    close();
  }

  function handleClick(e: React.MouseEvent) {
    e.stopPropagation();
    e.preventDefault();
    if (anchor) {
      setAnchor(null);
    } else {
      open();
    }
  }

  function handleTouchStart(e: React.TouchEvent) {
    // Prevent double-tap zoom on mobile
    e.stopPropagation();
  }

  // Close on outside click
  useEffect(() => {
    if (!anchor) return;
    function onOutside(e: MouseEvent | TouchEvent) {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target)) return;
      if (tooltipRef.current?.contains(target)) return;
      setAnchor(null);
    }
    document.addEventListener("mousedown", onOutside);
    document.addEventListener("touchstart", onOutside);
    return () => {
      document.removeEventListener("mousedown", onOutside);
      document.removeEventListener("touchstart", onOutside);
    };
  }, [anchor]);

  // Compute position: prefer below, flip above if not enough room
  const viewportH = typeof window !== "undefined" ? window.innerHeight : 800;
  const viewportW = typeof window !== "undefined" ? window.innerWidth : 1200;
  let top: number | undefined;
  let bottom: number | undefined;
  let left: number | undefined;
  let arrowOnBottom = false;
  let arrowLeftPx: number | undefined;

  if (anchor) {
    const spaceBelow = viewportH - anchor.bottom;
    const spaceAbove = anchor.top;
    if (spaceBelow >= 200 || spaceBelow >= spaceAbove) {
      top = anchor.bottom + 8;
      arrowOnBottom = false;
    } else {
      bottom = viewportH - anchor.top + 8;
      arrowOnBottom = true;
    }
    // Center under/over trigger, clamp to viewport
    const idealLeft = anchor.left + anchor.width / 2 - width / 2;
    left = Math.max(8, Math.min(idealLeft, viewportW - width - 8));
    // Arrow points at trigger center, clamped within tooltip bounds
    const triggerCenter = anchor.left + anchor.width / 2;
    arrowLeftPx = Math.max(12, Math.min(triggerCenter - left, width - 12));
  }

  const arrowStyle = { left: arrowLeftPx, transform: "translateX(-50%)" };

  const tooltip = anchor && (
    <div
      ref={tooltipRef}
      style={{ position: "fixed", top, bottom, left, width, zIndex: 9999 }}
      className="rounded-xl border border-card-border bg-card shadow-modal p-3 text-xs pointer-events-auto"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {/* Arrow */}
      {!arrowOnBottom && (
        <>
          <div
            className="absolute border-[5px] border-transparent border-b-card-border"
            style={{ bottom: "100%", ...arrowStyle }}
          />
          <div
            className="absolute border-[5px] border-transparent border-b-card"
            style={{ bottom: "calc(100% - 1px)", ...arrowStyle }}
          />
        </>
      )}
      {arrowOnBottom && (
        <>
          <div
            className="absolute border-[5px] border-transparent border-t-card-border"
            style={{ top: "100%", ...arrowStyle }}
          />
          <div
            className="absolute border-[5px] border-transparent border-t-card"
            style={{ top: "calc(100% - 1px)", ...arrowStyle }}
          />
        </>
      )}
      {children}
    </div>
  );

  return (
    <span
      ref={triggerRef}
      tabIndex={0}
      className={`relative inline-block cursor-help touch-manipulation min-h-[24px] min-w-[24px] ${className ?? ""}`}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onFocus={open}
      onBlur={() => close(0)}
      onClick={handleClick}
      onTouchStart={handleTouchStart}
    >
      {trigger}
      {mounted && typeof document !== "undefined" && anchor && createPortal(tooltip, document.body)}
    </span>
  );
}
