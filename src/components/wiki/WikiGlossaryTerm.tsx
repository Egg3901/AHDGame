"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

interface WikiGlossaryTermProps {
  term: string;
  definition: string;
}

/**
 * Inline jargon tooltip. First occurrence of a glossary term is wrapped in
 * this trigger. Opens on hover (mouse), focus (keyboard), and tap (touch).
 * Escape, blur, and outside tap close it.
 */
export function WikiGlossaryTerm({ term, definition }: WikiGlossaryTermProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const tooltipId = useId();
  const [coords, setCoords] = useState({ top: 0, left: 0, width: 256 });

  const place = useCallback(() => {
    if (!triggerRef.current) return;
    const r = triggerRef.current.getBoundingClientRect();
    const width = Math.min(256, Math.max(180, window.innerWidth - 16));
    const spaceBelow = window.innerHeight - r.bottom;
    const top = spaceBelow >= 120 ? r.bottom + 8 : Math.max(8, r.top - 8);
    const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
    setCoords({
      top: spaceBelow >= 120 ? top : top,
      left,
      width,
    });
    if (spaceBelow < 120) {
      setCoords({
        top: Math.max(8, r.top - 8),
        left,
        width,
      });
    }
  }, []);

  const openPanel = useCallback(() => {
    place();
    setOpen(true);
  }, [place]);

  const closePanel = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        closePanel();
        triggerRef.current?.focus();
      }
    }
    function onOutside(e: MouseEvent | TouchEvent) {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target)) return;
      if (panelRef.current?.contains(target)) return;
      closePanel();
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onOutside);
    document.addEventListener("touchstart", onOutside);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onOutside);
      document.removeEventListener("touchstart", onOutside);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, closePanel, place]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="cursor-help rounded-sm border-b border-dotted border-primary/70 bg-transparent p-0 font-inherit text-inherit [font-size:inherit] [line-height:inherit] hover:border-primary hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        aria-describedby={open ? tooltipId : undefined}
        aria-expanded={open}
        aria-label={`${term}: glossary definition`}
        onPointerEnter={(e) => {
          if (e.pointerType !== "mouse") return;
          openPanel();
        }}
        onPointerLeave={(e) => {
          if (e.pointerType !== "mouse") return;
          closePanel();
        }}
        onFocus={() => {
          if (!triggerRef.current?.matches(":focus-visible")) return;
          openPanel();
        }}
        onBlur={(e) => {
          if (panelRef.current?.contains(e.relatedTarget as Node)) return;
          closePanel();
        }}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (open) closePanel();
          else openPanel();
        }}
      >
        {term}
      </button>
      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={panelRef}
            id={tooltipId}
            role="tooltip"
            style={{
              position: "fixed",
              top: coords.top,
              left: coords.left,
              width: coords.width,
              zIndex: 9999,
            }}
            className="rounded-lg border border-card-border bg-card px-3 py-2 text-left text-xs font-normal normal-case tracking-normal text-foreground shadow-lg"
          >
            <span className="mb-0.5 block font-semibold text-foreground">{term}</span>
            {definition}
          </div>,
          document.body
        )}
    </>
  );
}
