"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";

export interface WikiSearchHit {
  slug: string;
  title: string;
  description?: string;
}

interface WikiSiteHeaderProps {
  playUrl: string;
  docsUrl: string;
}

export function wikiPageHref(slug: string): string {
  return `/wiki/${slug}`;
}

export function WikiSiteHeader({ playUrl, docsUrl }: WikiSiteHeaderProps) {
  return (
    <header className="sticky top-0 z-40 border-b border-card-border bg-background/95 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-2.5 sm:px-6">
        <Link
          href="/wiki"
          className="shrink-0 font-serif text-base font-semibold text-foreground hover:text-primary"
        >
          Wiki
        </Link>
        <WikiSearchBox />
        <nav
          aria-label="Wiki site links"
          className="ml-auto flex shrink-0 items-center gap-3 text-sm"
        >
          <a href={playUrl} className="text-muted transition-colors hover:text-foreground">
            Play
          </a>
          <a href={docsUrl} className="text-muted transition-colors hover:text-foreground">
            Docs
          </a>
        </nav>
      </div>
    </header>
  );
}

function WikiSearchBox() {
  const router = useRouter();
  const listId = useId();
  const inputId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<WikiSearchHit[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState(0);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setHits([]);
      setLoading(false);
      setError(null);
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/wiki/search?q=${encodeURIComponent(q)}&limit=8`, {
          signal: controller.signal,
        });
        if (!res.ok) {
          setError("Search failed.");
          setHits([]);
          return;
        }
        const body = (await res.json()) as { results?: WikiSearchHit[] };
        const results = Array.isArray(body.results) ? body.results : [];
        setHits(results);
        setActive(0);
        setOpen(true);
      } catch {
        if (controller.signal.aborted) return;
        setError("Search failed.");
        setHits([]);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 250);

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [query]);

  useEffect(() => {
    function onPointerDown(event: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, []);

  function goTo(hit: WikiSearchHit) {
    setOpen(false);
    router.push(wikiPageHref(hit.slug));
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      setOpen(false);
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setActive((i) => Math.min(i + 1, Math.max(hits.length - 1, 0)));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
      return;
    }
    if (event.key === "Enter" && hits[active]) {
      event.preventDefault();
      goTo(hits[active]);
    }
  }

  const showPanel = open && query.trim().length >= 2;

  return (
    <div ref={rootRef} className="relative min-w-0 flex-1">
      <label htmlFor={inputId} className="sr-only">
        Search wiki
      </label>
      <input
        id={inputId}
        type="search"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => {
          if (hits.length > 0 || error) setOpen(true);
        }}
        onKeyDown={onKeyDown}
        placeholder="Search wiki"
        autoComplete="off"
        role="combobox"
        aria-expanded={showPanel}
        aria-controls={listId}
        aria-autocomplete="list"
        className="w-full rounded-lg border border-card-border bg-card px-3 py-1.5 text-sm text-foreground placeholder:text-muted/70 outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/40"
      />
      {showPanel && (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-50 mt-1 max-h-80 w-full overflow-auto rounded-lg border border-card-border bg-card py-1 shadow-modal"
        >
          {loading && hits.length === 0 && !error && (
            <li className="px-3 py-2 text-sm text-muted">Searching...</li>
          )}
          {error && <li className="px-3 py-2 text-sm text-muted">{error}</li>}
          {!loading && !error && hits.length === 0 && (
            <li className="px-3 py-2 text-sm text-muted">No matching pages.</li>
          )}
          {hits.map((hit, index) => (
            <li key={hit.slug} role="option" aria-selected={index === active}>
              <Link
                href={wikiPageHref(hit.slug)}
                className={`block px-3 py-2 text-sm hover:bg-card-elevated ${
                  index === active ? "bg-card-elevated" : ""
                }`}
                onMouseEnter={() => setActive(index)}
                onClick={() => setOpen(false)}
              >
                <span className="block font-medium text-foreground">{hit.title}</span>
                {hit.description ? (
                  <span className="mt-0.5 line-clamp-1 block text-xs text-muted">
                    {hit.description}
                  </span>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
