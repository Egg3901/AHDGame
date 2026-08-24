"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Avatar } from "@/components/Avatar";
import { useAuthMe, type ClientNavBootstrap } from "@/contexts/AuthDataContext";

/** The wiki surfaces search can return. Mirrors `WikiSearchKind` on the server. */
export type WikiSearchHitKind =
  | "page"
  | "election"
  | "office"
  | "cabinet"
  | "leadership"
  | "seat"
  | "party"
  | "category"
  | "path";

export interface WikiSearchHit {
  slug: string;
  title: string;
  description?: string;
  /**
   * Generated surfaces do not live at /wiki/<slug> — a party page is
   * /wiki/party/<id> — so the server sends the href rather than letting the
   * client derive one from the slug.
   */
  href?: string;
  kind?: WikiSearchHitKind;
}

const KIND_LABELS: Record<WikiSearchHitKind, string> = {
  page: "Pages",
  category: "Categories",
  path: "Learning paths",
  party: "Parties",
  seat: "Seats",
  office: "Offices",
  cabinet: "Cabinet",
  leadership: "Leadership",
  election: "Elections",
};

export interface WikiSearchGroup {
  kind: string;
  label: string;
  hits: WikiSearchHit[];
}

interface WikiSiteHeaderProps {
  playUrl: string;
  docsUrl: string;
}

export interface WikiAccountProfile {
  name: string;
  avatarUrl: string | null;
  borderKey: string | null;
  tintColor: string | null;
}

export function wikiPageHref(slug: string): string {
  return `/wiki/${slug}`;
}

/** Prefer the server-supplied href; fall back to the authored-page path. */
export function wikiHitHref(hit: WikiSearchHit): string {
  return hit.href ?? wikiPageHref(hit.slug);
}

/**
 * Group ranked hits by surface without disturbing the ranking: groups appear in
 * order of their best-ranked member, and hits keep their order inside a group.
 * Flattening the groups therefore still yields the ranked list, which is what
 * keyboard navigation walks.
 */
export function groupWikiSearchHits(hits: WikiSearchHit[]): WikiSearchGroup[] {
  const groups: WikiSearchGroup[] = [];
  const byKind = new Map<string, WikiSearchGroup>();

  for (const hit of hits) {
    const kind = hit.kind ?? "page";
    let group = byKind.get(kind);
    if (!group) {
      group = { kind, label: KIND_LABELS[kind as WikiSearchHitKind] ?? "Wiki", hits: [] };
      byKind.set(kind, group);
      groups.push(group);
    }
    group.hits.push(hit);
  }

  return groups;
}

export function wikiGamePath(playUrl: string, path: string): string {
  const base = playUrl.replace(/\/$/, "");
  const suffix = path.startsWith("/") ? path : `/${path}`;
  return `${base}${suffix}`;
}

export function wikiAccountFromNav(navData: ClientNavBootstrap | null): WikiAccountProfile | null {
  const user = navData?.user;
  if (!user) return null;
  const char = (navData.isImperialMode ? user.imperialCharacter : user.character) as {
    avatarUrl?: string | null;
    borderKey?: string | null;
    tintColor?: string | null;
    name?: string;
  } | null;
  return {
    name: char?.name ?? navData.characterName ?? user.username ?? "Player",
    avatarUrl: char?.avatarUrl ?? null,
    borderKey: char?.borderKey ?? null,
    tintColor: char?.tintColor ?? null,
  };
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
          <WikiAccountMenu playUrl={playUrl} />
        </nav>
      </div>
    </header>
  );
}

function WikiAccountMenu({ playUrl }: { playUrl: string }) {
  const { navData, loading } = useAuthMe();
  const profile = wikiAccountFromNav(navData);
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function onPointerDown(event: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  async function signOut() {
    setOpen(false);
    try {
      const res = await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" });
      if (res.ok) window.location.reload();
    } catch {
      /* stay on the wiki if logout fails */
    }
  }

  if (loading && !profile) {
    return <div className="h-9 w-9 shrink-0 animate-pulse rounded-lg bg-card-border" />;
  }

  if (!profile) {
    return (
      <a
        href={wikiGamePath(playUrl, "/login")}
        className="text-muted transition-colors hover:text-foreground"
      >
        Sign in
      </a>
    );
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={profile.name}
        className={`relative flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-card-border bg-card transition-opacity hover:opacity-90 ${open ? "ring-2 ring-primary/40" : ""}`}
      >
        <Avatar
          url={profile.avatarUrl}
          name={profile.name}
          size="h-9 w-9"
          borderKey={profile.borderKey}
          tintColor={profile.tintColor}
          className="rounded-lg"
        />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 z-50 mt-2 w-52 rounded-xl border border-card-border bg-card py-1 shadow-modal"
        >
          <p className="truncate px-3 py-2 text-sm font-medium text-foreground">{profile.name}</p>
          <a
            role="menuitem"
            href={wikiGamePath(playUrl, "/profile")}
            className="block px-3 py-2 text-sm text-muted transition-colors hover:bg-card-elevated hover:text-foreground"
            onClick={() => setOpen(false)}
          >
            Profile
          </a>
          <button
            type="button"
            role="menuitem"
            onClick={() => void signOut()}
            className="block w-full px-3 py-2 text-left text-sm text-error transition-colors hover:bg-card-elevated"
          >
            Sign out
          </button>
        </div>
      )}
    </div>
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

  const groups = useMemo(() => groupWikiSearchHits(hits), [hits]);
  // Flattening the groups preserves rank order, so the arrow keys walk the list
  // in the same order it is painted.
  const ordered = useMemo(() => groups.flatMap((group) => group.hits), [groups]);
  const indexOfHit = useMemo(() => new Map(ordered.map((hit, index) => [hit, index])), [ordered]);

  function goTo(hit: WikiSearchHit) {
    setOpen(false);
    router.push(wikiHitHref(hit));
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      setOpen(false);
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setActive((i) => Math.min(i + 1, Math.max(ordered.length - 1, 0)));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
      return;
    }
    if (event.key === "Enter" && ordered[active]) {
      event.preventDefault();
      goTo(ordered[active]);
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
          {groups.map((group) => (
            // A named group keeps the visual sectioning available to screen
            // readers; the inner list is presentational so its options are still
            // exposed as belonging to the listbox.
            <li key={group.kind} role="group" aria-label={group.label}>
              <p
                aria-hidden="true"
                className="px-3 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted"
              >
                {group.label}
              </p>
              <ul role="presentation">
                {group.hits.map((hit) => {
                  const index = indexOfHit.get(hit) ?? 0;
                  return (
                    <li
                      key={`${group.kind}-${hit.slug}`}
                      role="option"
                      aria-selected={index === active}
                    >
                      <Link
                        href={wikiHitHref(hit)}
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
                  );
                })}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
