"use client";

import { useMemo, useState } from "react";
import {
  getAdminDestinations,
  type AdminDestination,
  type MainTabId,
} from "@/components/admin/tabs/AdminTabsConfig";

interface AdminCommandPaletteProps {
  open: boolean;
  onClose: () => void;
  onNavigate: (tab: MainTabId, sub?: string, params?: Record<string, string>) => void;
}

const MAX_RESULTS = 12;

/** ⌘K jump palette over the admin nav config: every tab, sub-tab, and heal
 * category. Pure client-side filter — no requests. The global shortcut
 * listener lives in AdminTabs so the palette can also open from the status
 * bar trigger. */
export function AdminCommandPalette({ open, onClose, onNavigate }: AdminCommandPaletteProps) {
  // The dialog mounts fresh each time the palette opens, so query/selection
  // state resets without any effects.
  if (!open) return null;
  return <PaletteDialog onClose={onClose} onNavigate={onNavigate} />;
}

function PaletteDialog({ onClose, onNavigate }: Omit<AdminCommandPaletteProps, "open">) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);

  const destinations = useMemo(() => getAdminDestinations(), []);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return destinations.slice(0, MAX_RESULTS);
    return destinations
      .filter((d) => `${d.group} ${d.label} ${d.keywords ?? ""}`.toLowerCase().includes(q))
      .slice(0, MAX_RESULTS);
  }, [destinations, query]);

  const pick = (dest: AdminDestination) => {
    onNavigate(dest.tab, dest.sub, dest.params);
    onClose();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const dest = results[activeIndex];
      if (dest) pick(dest);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex justify-center bg-black/60 pt-[12vh] backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Admin command palette"
    >
      <div
        className="h-fit w-[32rem] max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-card-border bg-card shadow-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2.5 border-b border-card-border px-3.5 py-3">
          <svg
            className="h-4 w-4 shrink-0 text-muted"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
            aria-hidden
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M21 21l-4.35-4.35M17 10.5a6.5 6.5 0 11-13 0 6.5 6.5 0 0113 0z"
            />
          </svg>
          <input
            autoFocus
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActiveIndex(0);
            }}
            onKeyDown={onKeyDown}
            placeholder="Jump to tab, sub-tab, or tool…"
            className="min-w-0 flex-1 bg-transparent text-body outline-none placeholder:text-muted"
            aria-label="Search admin destinations"
          />
          <kbd className="shrink-0 rounded border border-card-border px-1.5 py-px font-mono text-body-xs text-muted">
            esc
          </kbd>
        </div>
        <div className="max-h-80 overflow-y-auto p-1.5" role="listbox">
          {results.length === 0 && (
            <div className="px-3 py-6 text-center text-body-sm text-muted">No matches</div>
          )}
          {results.map((dest, i) => (
            <button
              key={`${dest.tab}-${dest.sub ?? ""}-${dest.params ? JSON.stringify(dest.params) : ""}`}
              type="button"
              role="option"
              aria-selected={i === activeIndex}
              onMouseEnter={() => setActiveIndex(i)}
              onClick={() => pick(dest)}
              className={`flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors ${
                i === activeIndex ? "bg-primary/10 text-foreground" : "text-foreground"
              }`}
            >
              <span className="w-16 shrink-0 truncate text-body-xs text-muted">{dest.group}</span>
              <span className="min-w-0 flex-1 truncate text-body font-medium">{dest.label}</span>
              <span className="shrink-0 text-body-xs text-muted" aria-hidden>
                ↵
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
