"use client";

import { useState, useEffect, useCallback, useId, useRef, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type { SearchResult } from "@/lib/search/types";

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

interface UniversalSearchProps {
  // When true, focus the input on transition — used by the navbar to grab focus
  // once the leftward reveal animation plays so the user can type immediately.
  open?: boolean;
  onNavigate?: () => void;
}

// Message ids under nav.search.types, resolved via t() at render time.
const TYPE_LABEL_KEY: Record<SearchResult["type"], string> = {
  politician: "search.types.politician",
  corporation: "search.types.corporation",
  seat: "search.types.seat",
  region: "search.types.region",
  election: "search.types.election",
  bill: "search.types.bill",
  page: "search.types.page",
  commodity: "search.types.commodity",
  currency: "search.types.currency",
  bond: "search.types.bond",
  admin: "search.types.admin",
};

// Token-based badge classes so themes stay in sync.
/** Result type badges are neutral; only admin results, visible to admins alone, stand apart. */
const TYPE_BADGE: Record<SearchResult["type"], string> = {
  politician: "bg-card-elevated text-muted",
  corporation: "bg-card-elevated text-muted",
  seat: "bg-card-elevated text-muted",
  region: "bg-card-elevated text-muted",
  election: "bg-card-elevated text-muted",
  bill: "bg-card-elevated text-muted",
  page: "bg-card-elevated text-muted",
  commodity: "bg-card-elevated text-muted",
  currency: "bg-card-elevated text-muted",
  bond: "bg-card-elevated text-muted",
  admin: "bg-red-500/15 text-red-400",
};

export function UniversalSearch({ open, onNavigate }: UniversalSearchProps = {}) {
  const t = useTranslations("nav");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const [dropdownPosition, setDropdownPosition] = useState({ top: 0, left: 0, width: 0 });
  const [portalContainer, setPortalContainer] = useState<Element | null>(null);

  const router = useRouter();
  const resultListId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const keyboardSelectionRef = useRef(false);
  const attachInput = useCallback((input: HTMLInputElement | null) => {
    inputRef.current = input;
    setPortalContainer(input ? (input.closest('[role="dialog"]') ?? document.body) : null);
  }, []);

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
    abortControllerRef.current?.abort();
    keyboardSelectionRef.current = false;

    if (query.trim().length < 2) {
      setResults([]);
      setLoading(false);
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
        setFocusedIndex(-1);
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
      abortControllerRef.current?.abort();
    };
  }, [query]);

  // Keep popups inside a surrounding dialog so the mobile drawer cannot cover
  // them or hide them from assistive technology. Otherwise portal into <body>.
  // Fixed positioning is viewport-relative. Clamp into the viewport so the
  // dropdown never overflows left/right on narrow screens or near the edge.
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
    const revealPositionTimer = window.setTimeout(computePosition, 320);
    window.addEventListener("scroll", computePosition, true);
    window.addEventListener("resize", computePosition, true);
    return () => {
      window.clearTimeout(revealPositionTimer);
      window.removeEventListener("scroll", computePosition, true);
      window.removeEventListener("resize", computePosition, true);
    };
  }, [isOpen, open, results.length]);

  // Click outside handler
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      const target = event.target as Node;
      if (dropdownRef.current?.contains(target) || inputRef.current?.contains(target)) return;
      setIsOpen(false);
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  const submitSearch = () => {
    const submittedQuery = query.trim();
    if (!submittedQuery) return;
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    abortControllerRef.current?.abort();
    setIsOpen(false);
    setFocusedIndex(-1);
    setQuery("");
    router.push(`/search?q=${encodeURIComponent(submittedQuery)}`);
    onNavigate?.();
  };

  const handleResultClick = (href: string) => {
    router.push(href);
    setIsOpen(false);
    setFocusedIndex(-1);
    setQuery("");
    keyboardSelectionRef.current = false;
    onNavigate?.();
  };

  const handleInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      if (isOpen) {
        event.preventDefault();
        setIsOpen(false);
        setFocusedIndex(-1);
        keyboardSelectionRef.current = false;
      }
      return;
    }

    if (event.key === "ArrowDown" && results.length > 0) {
      event.preventDefault();
      keyboardSelectionRef.current = true;
      setIsOpen(true);
      setFocusedIndex((previous) => (previous + 1) % results.length);
      return;
    }

    if (event.key === "ArrowUp" && results.length > 0) {
      event.preventDefault();
      keyboardSelectionRef.current = true;
      setIsOpen(true);
      setFocusedIndex((previous) => (previous <= 0 ? results.length - 1 : previous - 1));
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      const selectedResult = keyboardSelectionRef.current ? results[focusedIndex] : undefined;
      if (selectedResult) handleResultClick(selectedResult.href);
      else submitSearch();
    }
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
          ref={attachInput}
          type="text"
          value={query}
          maxLength={200}
          onChange={(e) => {
            keyboardSelectionRef.current = false;
            setFocusedIndex(-1);
            setResults([]);
            setIsOpen(true);
            setQuery(e.target.value);
          }}
          onFocus={() => setIsOpen(true)}
          onClick={() => setIsOpen(true)}
          onKeyDown={handleInputKeyDown}
          placeholder={t("search.placeholder")}
          aria-label={t("search.ariaLabel")}
          role="combobox"
          aria-expanded={isOpen}
          aria-controls={`${resultListId}-results`}
          aria-activedescendant={
            isOpen && focusedIndex >= 0 ? `${resultListId}-result-${focusedIndex}` : undefined
          }
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

      {portalContainer &&
        isOpen &&
        results.length > 0 &&
        createPortal(
          <div
            ref={dropdownRef}
            id={`${resultListId}-results`}
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
                id={`${resultListId}-result-${index}`}
                role="option"
                aria-selected={index === focusedIndex}
                onClick={() => handleResultClick(result.href)}
                onMouseEnter={() => {
                  keyboardSelectionRef.current = false;
                  setFocusedIndex(index);
                }}
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
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold text-foreground truncate">{result.title}</p>
                    <span
                      className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${TYPE_BADGE[result.type]}`}
                    >
                      {t(TYPE_LABEL_KEY[result.type])}
                    </span>
                  </div>
                  <p className="text-xs text-muted truncate">{result.subtitle}</p>
                </div>
              </button>
            ))}
          </div>,
          portalContainer
        )}

      {portalContainer &&
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
            <p className="text-sm text-muted">{t("search.noResults", { query })}</p>
          </div>,
          portalContainer
        )}

      {portalContainer &&
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
              <p className="example-title text-xs font-semibold text-muted">
                {t("search.trySearchingFor")}
              </p>
            </div>
            <div className="example-grid grid grid-cols-1 sm:grid-cols-2 gap-2">
              {[
                "Nicola Sturgeon",
                "General Electric",
                "California",
                "Parliament",
                "Texas",
                "Bond Markets",
                "FTSE 100",
                "Legislation",
              ].map((example, idx) => (
                <button
                  key={example}
                  onClick={() => {
                    setQuery(example);
                    inputRef.current?.focus();
                  }}
                  style={{
                    animation: `fade-in-text 0.6s ease-out ${0.1 + idx * 0.05}s both`,
                  }}
                  className="group relative px-3 py-2 rounded-lg bg-card-muted/30 hover:bg-card-muted/60 transition-colors border border-card-border/40 hover:border-card-border/60 text-xs font-medium text-foreground hover:text-primary"
                >
                  {example}
                </button>
              ))}
            </div>
          </div>,
          portalContainer
        )}
    </div>
  );
}
