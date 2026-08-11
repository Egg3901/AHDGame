"use client";

import { useEffect, useRef, useState } from "react";

interface SubTabOption<T extends string> {
  id: T;
  label: string;
}

interface SubTabBarProps<T extends string> {
  options: SubTabOption<T>[];
  active: T;
  onChange: (id: T) => void;
  /** Wrap tabs onto multiple rows instead of a single scrolling row. Use for long
   *  lists (many countries) so every tab is visible without horizontal scrolling. */
  wrap?: boolean;
}

export function SubTabBar<T extends string>({
  options,
  active,
  onChange,
  wrap = false,
}: SubTabBarProps<T>) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const checkScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 1);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
  };

  useEffect(() => {
    checkScroll();
    const el = scrollRef.current;
    if (!el) return;
    el.addEventListener("scroll", checkScroll, { passive: true });
    window.addEventListener("resize", checkScroll);
    return () => {
      el.removeEventListener("scroll", checkScroll);
      window.removeEventListener("resize", checkScroll);
    };
  }, [options.length]);

  // Keep the active tab centered in view.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const activeButton = Array.from(el.querySelectorAll("[data-tab-id]")).find(
      (btn) => (btn as HTMLElement).dataset.tabId === active
    ) as HTMLElement | undefined;
    if (activeButton) {
      activeButton.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
    }
  }, [active]);

  const scroll = (direction: "left" | "right") => {
    const el = scrollRef.current;
    if (!el) return;
    const amount = Math.max(el.clientWidth * 0.5, 160);
    el.scrollBy({ left: direction === "left" ? -amount : amount, behavior: "smooth" });
  };

  const tabButtons = options.map((opt) => (
    <button
      key={opt.id}
      type="button"
      data-tab-id={opt.id}
      onClick={() => onChange(opt.id)}
      className={`shrink-0 cursor-pointer rounded-lg px-3 py-2 text-xs font-medium transition-colors sm:px-4 sm:py-2.5 sm:text-sm ${
        active === opt.id
          ? "bg-primary text-primary-foreground"
          : "text-muted hover:bg-white/5 hover:text-foreground"
      }`}
    >
      {opt.label}
    </button>
  ));

  // Wrap mode: every tab visible across rows, no horizontal scrolling/overflow.
  if (wrap) {
    return (
      <div className="flex flex-wrap gap-1 rounded-xl border border-card-border bg-card p-1 shadow-sm">
        {tabButtons}
      </div>
    );
  }

  return (
    <div className="relative">
      {/* Left overflow indicator */}
      {canScrollLeft && (
        <>
          <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-8 rounded-l-xl bg-gradient-to-r from-card to-transparent" />
          <button
            type="button"
            onClick={() => scroll("left")}
            className="absolute left-1 top-1/2 z-20 -translate-y-1/2 rounded-full border border-card-border bg-card-elevated p-1 text-muted shadow-sm transition-colors hover:text-foreground"
            aria-label="Scroll tabs left"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
        </>
      )}

      {/* Below sm the row wraps so every tab is visible without horizontal
          scrolling; from sm up it becomes a single scrolling row with
          chevron/gradient overflow affordances. */}
      <div ref={scrollRef} className="scrollbar-hide overflow-x-auto">
        <div className="flex w-fit max-w-full flex-wrap gap-1 rounded-xl border border-card-border bg-card p-1 shadow-sm sm:max-w-none sm:flex-nowrap">
          {tabButtons}
        </div>
      </div>

      {/* Right overflow indicator */}
      {canScrollRight && (
        <>
          <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-8 rounded-r-xl bg-gradient-to-l from-card to-transparent" />
          <button
            type="button"
            onClick={() => scroll("right")}
            className="absolute right-1 top-1/2 z-20 -translate-y-1/2 rounded-full border border-card-border bg-card-elevated p-1 text-muted shadow-sm transition-colors hover:text-foreground"
            aria-label="Scroll tabs right"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </>
      )}
    </div>
  );
}

function ChevronLeft({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
      aria-hidden="true"
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
    </svg>
  );
}

function ChevronRight({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
      aria-hidden="true"
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
    </svg>
  );
}
