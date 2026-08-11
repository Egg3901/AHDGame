"use client";

import { useState, useRef, useEffect, useCallback } from "react";

interface TooltipProps {
  content: string;
  /** Accessible name for the trigger button. */
  label?: string;
}

/**
 * Info tooltip for table headers and labeled fields.
 * Shows on hover (desktop), tap-to-toggle (mobile), and keyboard focus.
 * Dismisses on outside tap/click, blur, or Escape.
 * Uses position:fixed so it isn't clipped by overflow-x:auto table wrappers.
 */
export function Tooltip({ content, label = "More information" }: TooltipProps) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState({ x: 0, y: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);

  const computeCoords = useCallback(() => {
    if (!btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    setCoords({ x: r.left + r.width / 2, y: r.top - 6 });
  }, []);

  useEffect(() => {
    if (!open) return;
    function close(e: MouseEvent | TouchEvent) {
      if (btnRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", close);
    document.addEventListener("touchstart", close);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("touchstart", close);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <span className="relative inline-flex items-center">
      <button
        ref={btnRef}
        type="button"
        onPointerEnter={(e) => {
          // Gate hover to real mouse pointers: on touch, the emulated
          // mouseenter+click pair would open then immediately toggle closed.
          if (e.pointerType !== "mouse") return;
          computeCoords();
          setOpen(true);
        }}
        onPointerLeave={(e) => {
          if (e.pointerType !== "mouse") return;
          setOpen(false);
        }}
        onClick={(e) => {
          e.stopPropagation();
          computeCoords();
          setOpen((v) => !v);
        }}
        onFocus={() => {
          // Only auto-open for keyboard focus, not pointer-driven focus
          // (pointer focus is followed by click, which handles the toggle).
          if (!btnRef.current?.matches(":focus-visible")) return;
          computeCoords();
          setOpen(true);
        }}
        onBlur={() => setOpen(false)}
        className="relative ml-1 inline-flex h-3.5 w-3.5 items-center justify-center rounded-full border border-muted/40 bg-card-elevated text-[9px] font-bold text-muted transition-colors after:absolute after:left-1/2 after:top-1/2 after:h-10 after:w-10 after:-translate-x-1/2 after:-translate-y-1/2 after:content-[''] hover:border-primary/50 hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        aria-label={label}
        aria-expanded={open}
      >
        ?
      </button>
      {open && (
        <span
          style={{
            position: "fixed",
            left: coords.x,
            top: coords.y,
            transform: "translate(-50%, -100%)",
            zIndex: 9999,
          }}
          role="tooltip"
          className="pointer-events-none w-48 whitespace-normal rounded-lg border border-card-border bg-card px-2.5 py-1.5 text-xs font-normal normal-case tracking-normal text-foreground shadow-lg"
        >
          {content}
          <span
            className="absolute -bottom-[5px] left-1/2 h-2.5 w-2.5 -translate-x-1/2 rotate-45 border-b border-r border-card-border bg-card"
            aria-hidden="true"
          />
        </span>
      )}
    </span>
  );
}
