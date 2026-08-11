"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ExchangeFilter } from "../types";
import type { ExchangeMetaEntry } from "../stockMarketRouting";

interface ExchangeSelectorProps {
  exchangeMeta: Record<string, ExchangeMetaEntry>;
  exchangeFilter: ExchangeFilter;
  onSelect: (key: string) => void;
}

/**
 * Country / Global filter for the stock-market hero.
 *
 * Desktop (sm+): inline pill row, one button per exchange. Original behavior.
 * Mobile (< sm): compact chip showing the current selection with a chevron that
 * opens a dropdown of the other exchanges. Avoids the row of buttons overflowing
 * the viewport on phones.
 */
export function ExchangeSelector({
  exchangeMeta,
  exchangeFilter,
  onSelect,
}: ExchangeSelectorProps) {
  const entries = Object.entries(exchangeMeta);
  const currentEntry = exchangeMeta[exchangeFilter] ?? exchangeMeta.global;
  const currentLabel = exchangeFilter === "global" ? "Global" : (currentEntry?.title ?? "Global");

  return (
    <>
      {/* Desktop: inline pill row */}
      <div className="hidden sm:flex bg-black/50 backdrop-blur-sm rounded-lg p-1 border border-white/10">
        {entries.map(([key, val]) => (
          <button
            key={key}
            onClick={() => onSelect(key)}
            className={`px-3 py-1 rounded-md text-xs font-bold uppercase tracking-wider transition-colors ${
              exchangeFilter === key
                ? "bg-primary text-white shadow-sm"
                : "text-white/70 hover:text-white"
            }`}
          >
            {key === "global" ? "Global" : val.title}
          </button>
        ))}
      </div>

      {/* Mobile: compact chip + dropdown */}
      <MobileExchangeDropdown
        entries={entries}
        exchangeFilter={exchangeFilter}
        currentLabel={currentLabel}
        onSelect={onSelect}
      />
    </>
  );
}

interface MenuPosition {
  /** Distance from the viewport top, when anchored below the trigger. */
  top?: number;
  /** Distance from the viewport bottom, when flipped above the trigger. */
  bottom?: number;
  /** Right-aligned to the trigger's right edge. */
  right: number;
  /** Hard cap so the list always fits on screen; scrolls past it. */
  maxHeight: number;
}

function MobileExchangeDropdown({
  entries,
  exchangeFilter,
  currentLabel,
  onSelect,
}: {
  entries: Array<[string, ExchangeMetaEntry]>;
  exchangeFilter: ExchangeFilter;
  currentLabel: string;
  onSelect: (key: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<MenuPosition | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [mounted] = useState(() => typeof window !== "undefined");

  // The dropdown is portaled to <body> so the hero header's `overflow-hidden`
  // (rounded image) cannot clip the last exchanges. Position it manually,
  // anchored to the trigger, flipping above when there isn't room below.
  const computePosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const r = trigger.getBoundingClientRect();
    const gap = 8; // matches the previous `mt-2`
    const margin = 8; // viewport breathing room
    const spaceBelow = window.innerHeight - r.bottom;
    const spaceAbove = r.top;
    const right = window.innerWidth - r.right;

    if (spaceBelow >= spaceAbove) {
      setPosition({ top: r.bottom + gap, right, maxHeight: spaceBelow - gap - margin });
    } else {
      setPosition({
        bottom: window.innerHeight - r.top + gap,
        right,
        maxHeight: spaceAbove - gap - margin,
      });
    }
  }, []);

  const toggle = useCallback(() => {
    // Position before the first paint so the menu never flashes unplaced.
    if (!open) computePosition();
    setOpen((v) => !v);
  }, [open, computePosition]);

  // Keep the menu anchored to the trigger while open as the page scrolls/resizes.
  useEffect(() => {
    if (!open) return;
    const onChange = () => computePosition();
    window.addEventListener("scroll", onChange, true);
    window.addEventListener("resize", onChange);
    return () => {
      window.removeEventListener("scroll", onChange, true);
      window.removeEventListener("resize", onChange);
    };
  }, [open, computePosition]);

  // Close on outside click / Escape. The menu lives in a portal, so check both
  // the trigger and the menu before treating a click as "outside".
  useEffect(() => {
    if (!open) return;
    function onOutside(e: MouseEvent | TouchEvent) {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
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

  const menu = open && position && (
    <div
      ref={menuRef}
      role="listbox"
      style={{
        position: "fixed",
        top: position.top,
        bottom: position.bottom,
        right: position.right,
        maxHeight: position.maxHeight,
      }}
      className="z-[60] min-w-[10rem] overflow-y-auto rounded-lg border border-white/15 bg-black/85 backdrop-blur-md shadow-xl py-1"
    >
      {entries.map(([key, val]) => {
        const label = key === "global" ? "Global" : val.title;
        const active = exchangeFilter === key;
        return (
          <button
            key={key}
            type="button"
            role="option"
            aria-selected={active}
            onClick={() => {
              onSelect(key);
              setOpen(false);
            }}
            className={`w-full text-left px-3 py-2 text-xs font-bold uppercase tracking-wider transition-colors ${
              active ? "bg-primary/30 text-white" : "text-white/80 hover:bg-white/10"
            }`}
          >
            {label}
          </button>
        );
      })}
    </div>
  );

  return (
    <div className="relative sm:hidden">
      <button
        ref={triggerRef}
        type="button"
        onClick={toggle}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Exchange filter, currently ${currentLabel}`}
        className="flex items-center gap-1.5 bg-black/50 backdrop-blur-sm rounded-lg px-3 py-1.5 border border-white/10 text-xs font-bold uppercase tracking-wider text-white"
      >
        <span>{currentLabel}</span>
        <svg
          className={`h-3 w-3 text-white/70 transition-transform ${open ? "rotate-180" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {mounted && typeof document !== "undefined" && menu && createPortal(menu, document.body)}
    </div>
  );
}
