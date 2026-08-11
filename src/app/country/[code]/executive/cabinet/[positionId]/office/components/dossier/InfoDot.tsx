"use client";

import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

/**
 * Small ⓘ info dot with a tooltip. Shows on hover (desktop),
 * tap-to-toggle (mobile), and keyboard focus. Dismisses on outside
 * tap/click, blur, or Escape.
 */
export function InfoDot({
  children,
  label = "More information",
}: {
  children: ReactNode;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    function onOutside(e: MouseEvent | TouchEvent) {
      if (rootRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onOutside);
    document.addEventListener("touchstart", onOutside);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onOutside);
      document.removeEventListener("touchstart", onOutside);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <span ref={rootRef} className="group relative inline-flex">
      <button
        ref={btnRef}
        type="button"
        aria-label={label}
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        onFocus={() => {
          // Only auto-open for keyboard focus, not pointer-driven focus
          // (pointer focus is followed by click, which handles the toggle).
          if (!btnRef.current?.matches(":focus-visible")) return;
          setOpen(true);
        }}
        onBlur={() => setOpen(false)}
        className="relative select-none rounded-full text-[12px] leading-none text-muted/60 after:absolute after:left-1/2 after:top-1/2 after:h-10 after:w-10 after:-translate-x-1/2 after:-translate-y-1/2 after:content-[''] hover:text-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        ⓘ
      </button>
      <span
        role="tooltip"
        className={`pointer-events-none absolute bottom-[calc(100%+8px)] left-1/2 z-40 w-[230px] -translate-x-1/2 rounded-[10px] border border-card-border bg-card-elevated px-3 py-2.5 text-left text-[11px] leading-relaxed text-muted shadow-xl transition-opacity group-hover:opacity-100 ${open ? "opacity-100" : "opacity-0"}`}
      >
        {children}
      </span>
    </span>
  );
}
