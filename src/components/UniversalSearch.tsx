"use client";

import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";

// Animated glow styles for admin search results
const adminGlowStyles = `
  @keyframes admin-search-glow {
    0%, 100% {
      box-shadow: 0 0 10px rgba(239, 68, 68, 0.5), 0 0 20px rgba(239, 68, 68, 0.3), inset 0 0 10px rgba(239, 68, 68, 0.1);
      border-color: rgba(239, 68, 68, 0.6);
    }
    50% {
      box-shadow: 0 0 20px rgba(239, 68, 68, 0.8), 0 0 40px rgba(239, 68, 68, 0.5), inset 0 0 15px rgba(239, 68, 68, 0.2);
      border-color: rgba(239, 68, 68, 0.9);
    }
  }
  @keyframes admin-result-glow {
    0%, 100% {
      background-color: rgba(239, 68, 68, 0.08);
      border-color: rgba(239, 68, 68, 0.2);
    }
    50% {
      background-color: rgba(239, 68, 68, 0.15);
      border-color: rgba(239, 68, 68, 0.4);
    }
  }
  @keyframes fade-in-text {
    0% {
      opacity: 0;
      transform: translateY(-8px);
    }
    100% {
      opacity: 1;
      transform: translateY(0);
    }
  }
  .admin-search-glow {
    animation: admin-search-glow 2s ease-in-out infinite;
  }
  .admin-result-item {
    animation: admin-result-glow 3s ease-in-out infinite;
  }
  .example-title {
    animation: fade-in-text 0.6s ease-out forwards;
  }
  .example-grid {
    animation: fade-in-text 0.8s ease-out forwards;
  }
`;

interface SearchResult {
  type:
    | "politician"
    | "seat"
    | "region"
    | "election"
    | "corporation"
    | "bill"
    | "page"
    | "commodity"
    | "currency"
    | "bond"
    | "admin";
  id: string;
  title: string;
  subtitle: string;
  href: string;
  icon: string;
}

interface UniversalSearchProps {
  // When true, focus the input on transition — used by the navbar to grab focus
  // once the leftward reveal animation plays so the user can type immediately.
  open?: boolean;
}

const TYPE_LABEL: Record<SearchResult["type"], string> = {
  politician: "Politician",
  corporation: "Corporation",
  seat: "Seat",
  region: "Region",
  election: "Election",
  bill: "Bill",
  page: "Wiki",
  commodity: "Commodity",
  currency: "Currency",
  bond: "Bond",
  admin: "Admin",
};

// Token-based badge classes so themes stay in sync.
const TYPE_BADGE: Record<SearchResult["type"], string> = {
  politician: "bg-secondary/15 text-secondary",
  corporation: "bg-success/15 text-success",
  seat: "bg-primary/15 text-primary",
  region: "bg-primary/15 text-primary",
  election: "bg-warning/15 text-warning",
  bill: "bg-muted/15 text-muted",
  page: "bg-card-elevated text-muted",
  commodity: "bg-amber-500/15 text-amber-600",
  currency: "bg-blue-500/15 text-blue-400",
  bond: "bg-purple-500/15 text-purple-400",
  admin: "bg-red-500/15 text-red-400",
};

export function UniversalSearch({ open }: UniversalSearchProps = {}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState(0);
  const [dropdownPosition, setDropdownPosition] = useState({ top: 0, left: 0, width: 0 });
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (open) {
      inputRef.current?.focus();
    }
  }, [open]);

  // Debounced search effect
  useEffect(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    if (!query.trim()) {
      setResults([]);
      setIsOpen(false);
      setLoading(false);
      abortControllerRef.current?.abort();
      return;
    }

    setLoading(true);

    debounceTimerRef.current = setTimeout(async () => {
      abortControllerRef.current?.abort();
      const controller = new AbortController();
      abortControllerRef.current = controller;
      try {
        const response = await fetch(`/api/search/universal?q=${encodeURIComponent(query)}`, {
          signal: controller.signal,
        });
        const data = await response.json();
        if (controller.signal.aborted) return;
        setResults(data.results || []);
        setIsOpen(true);
        setFocusedIndex(0);
      } catch (error) {
        if ((error as { name?: string })?.name === "AbortError") return;
        console.error("Search failed:", error);
        setResults([]);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 300);

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [query]);

  // Position the dropdown relative to the input. The dropdown is portalled into
  // <body>, so position:fixed is viewport-relative. Clamp into the viewport so
  // it never overflows left/right on narrow screens or near the edge.
  useEffect(() => {
    if (!isOpen || !inputRef.current) return;
    const computePosition = () => {
      const input = inputRef.current;
      if (!input) return;
      const rect = input.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const margin = 8;
      const width = Math.min(Math.max(rect.width, 280), viewportWidth - margin * 2);
      let left = rect.left;
      if (left + width > viewportWidth - margin) left = viewportWidth - width - margin;
      if (left < margin) left = margin;
      setDropdownPosition({ top: rect.bottom + margin, left, width });
    };
    computePosition();
    window.addEventListener("scroll", computePosition, true);
    window.addEventListener("resize", computePosition, true);
    return () => {
      window.removeEventListener("scroll", computePosition, true);
      window.removeEventListener("resize", computePosition, true);
    };
  }, [isOpen, results.length]);

  // Click outside handler
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node) &&
        inputRef.current &&
        !inputRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  // Keyboard handler — only active while the combobox has focus so arrow keys
  // elsewhere on the page aren't hijacked.
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (!isOpen || results.length === 0) return;
      if (document.activeElement !== inputRef.current) return;

      if (event.key === "ArrowDown") {
        event.preventDefault();
        setFocusedIndex((prev) => (prev + 1) % results.length);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        setFocusedIndex((prev) => (prev - 1 + results.length) % results.length);
      } else if (event.key === "Enter") {
        event.preventDefault();
        const selectedResult = results[focusedIndex];
        if (selectedResult) {
          router.push(selectedResult.href);
          setIsOpen(false);
          setQuery("");
        }
      } else if (event.key === "Escape") {
        event.preventDefault();
        setIsOpen(false);
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, results, focusedIndex, router]);

  const handleResultClick = (href: string) => {
    router.push(href);
    setIsOpen(false);
    setQuery("");
  };

  // Check if there are any admin results
  const hasAdminResults = results.some((r) => r.type === "admin");

  return (
    <div className="relative w-full">
      <style dangerouslySetInnerHTML={{ __html: adminGlowStyles }} />
      <div className="relative">
        <svg
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
          />
        </svg>
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search characters, corporations, bills…"
          aria-label="Search characters, corporations, bills, elections"
          role="combobox"
          aria-expanded={isOpen}
          aria-controls="search-results"
          aria-autocomplete="list"
          // text-base (16px) on mobile prevents iOS Safari from auto-zooming
          // into the input on focus; text-sm (14px) keeps the desktop density.
          className={`w-full rounded-lg border bg-card pl-9 pr-9 py-1.5 text-base md:text-sm text-foreground placeholder:text-muted focus:outline-none transition-all ${
            hasAdminResults
              ? "admin-search-glow"
              : "border-card-border focus:border-primary focus:ring-2 focus:ring-primary/20"
          }`}
        />
        {loading && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          </div>
        )}
      </div>

      {mounted &&
        isOpen &&
        results.length > 0 &&
        createPortal(
          <div
            ref={dropdownRef}
            id="search-results"
            role="listbox"
            style={{
              position: "fixed",
              top: dropdownPosition.top,
              left: dropdownPosition.left,
              width: dropdownPosition.width,
            }}
            className="rounded-xl border border-card-border bg-card shadow-modal z-[60] max-h-[28rem] overflow-y-auto overflow-hidden"
          >
            {results.map((result, index) => (
              <button
                key={`${result.type}-${result.id}`}
                role="option"
                aria-selected={index === focusedIndex}
                onClick={() => handleResultClick(result.href)}
                onMouseEnter={() => setFocusedIndex(index)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors border-b last:border-b-0 ${
                  result.type === "admin"
                    ? `admin-result-item ${
                        index === focusedIndex ? "border-b-red-500/40" : "border-b-red-500/20"
                      }`
                    : `border-b-card-border/60 ${
                        index === focusedIndex ? "bg-card-muted" : "hover:bg-card-muted/50"
                      }`
                }`}
              >
                <span
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-background text-base"
                  aria-hidden="true"
                >
                  {result.icon}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold text-foreground truncate">{result.title}</p>
                    <span
                      className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${TYPE_BADGE[result.type]}`}
                    >
                      {TYPE_LABEL[result.type]}
                    </span>
                  </div>
                  <p className="text-xs text-muted truncate">{result.subtitle}</p>
                </div>
              </button>
            ))}
          </div>,
          document.body
        )}

      {mounted &&
        isOpen &&
        !loading &&
        results.length === 0 &&
        query.trim() &&
        createPortal(
          <div
            ref={dropdownRef}
            style={{
              position: "fixed",
              top: dropdownPosition.top,
              left: dropdownPosition.left,
              width: dropdownPosition.width,
            }}
            className="rounded-xl border border-card-border bg-card shadow-modal z-[60] px-4 py-5 text-center"
          >
            <p className="text-sm text-muted">No results found for &quot;{query}&quot;</p>
          </div>,
          document.body
        )}

      {mounted &&
        isOpen &&
        !loading &&
        results.length === 0 &&
        !query.trim() &&
        createPortal(
          <div
            ref={dropdownRef}
            style={{
              position: "fixed",
              top: dropdownPosition.top,
              left: dropdownPosition.left,
              width: dropdownPosition.width,
            }}
            className="rounded-xl border border-card-border bg-card shadow-modal z-[60] px-4 py-6 text-center space-y-5"
          >
            <div>
              <p className="example-title text-xs font-semibold text-muted uppercase tracking-wider">
                Try searching for
              </p>
            </div>
            <div className="example-grid grid grid-cols-1 sm:grid-cols-2 gap-2">
              {[
                { name: "Nicola Sturgeon", icon: "👤" },
                { name: "General Electric", icon: "🏢" },
                { name: "California", icon: "📍" },
                { name: "Parliament", icon: "📄" },
                { name: "Texas", icon: "📍" },
                { name: "Bond Markets", icon: "📊" },
                { name: "FTSE 100", icon: "📈" },
                { name: "Legislation", icon: "📜" },
              ].map((example, idx) => (
                <button
                  key={example.name}
                  onClick={() => {
                    setQuery(example.name);
                    inputRef.current?.focus();
                  }}
                  style={{
                    animation: `fade-in-text 0.6s ease-out ${0.1 + idx * 0.05}s both`,
                  }}
                  className="group relative px-3 py-2 rounded-lg bg-card-muted/30 hover:bg-card-muted/60 transition-colors border border-card-border/40 hover:border-card-border/60 text-xs font-medium text-foreground hover:text-primary"
                >
                  <span className="mr-1.5">{example.icon}</span>
                  {example.name}
                </button>
              ))}
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}
