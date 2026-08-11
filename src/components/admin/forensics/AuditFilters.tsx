"use client";

// Filter bar for the audit stream. Primary filters (actor search-as-you-type,
// category, outcome, flagged-only) stay visible for the fast mod path; the rest
// (subject, action, turn/time ranges, specific flag) live behind a "More
// filters" disclosure so the default view stays uncluttered. All changes flow
// up via onChange; the parent debounces the actual fetch.

import { useEffect, useMemo, useRef, useState } from "react";
import { type AuditFilterState, CATEGORY_OPTIONS, EMPTY_FILTERS } from "./types";

const INPUT_CLS =
  "h-10 rounded-lg border border-card-border bg-background px-3 text-sm transition-colors placeholder:text-muted/70 hover:border-muted/50 focus:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/25 motion-reduce:transition-none";

interface UserOption {
  id: string;
  username: string;
  characterName: string | null;
}

interface AuditFiltersProps {
  filters: AuditFilterState;
  onChange: (next: AuditFilterState) => void;
  onReset: () => void;
  apiBase: string;
  /** Distinct flags observed in the current results, for the flag picker. */
  knownFlags: string[];
}

function useUserDirectory(apiBase: string) {
  const [users, setUsers] = useState<UserOption[] | null>(null);
  const [loading, setLoading] = useState(false);
  const loadedRef = useRef(false);

  const ensureLoaded = () => {
    if (loadedRef.current) return;
    loadedRef.current = true;
    setLoading(true);
    fetch(`${apiBase}/users?limit=2000`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((data) => {
        const raw = Array.isArray(data) ? data : (data.users ?? []);
        const opts: UserOption[] = raw.map(
          (u: { id?: string; _id?: string; username?: string; characterName?: string | null }) => ({
            id: String(u.id ?? u._id ?? ""),
            username: u.username ?? "(no username)",
            characterName: u.characterName ?? null,
          })
        );
        setUsers(opts);
      })
      .catch(() => setUsers([]))
      .finally(() => setLoading(false));
  };

  return { users, loading, ensureLoaded };
}

function ActorSearch({
  filters,
  onChange,
  apiBase,
}: Pick<AuditFiltersProps, "filters" | "onChange" | "apiBase">) {
  const { users, loading, ensureLoaded } = useUserDirectory(apiBase);
  const [query, setQuery] = useState(filters.actorLabel);
  const [open, setOpen] = useState(false);
  const [prevActorLabel, setPrevActorLabel] = useState(filters.actorLabel);
  const boxRef = useRef<HTMLDivElement>(null);

  // Keep the input in sync when the actor is cleared/changed externally,
  // adjusting state during render (React-recommended) rather than in an effect.
  if (filters.actorLabel !== prevActorLabel) {
    setPrevActorLabel(filters.actorLabel);
    setQuery(filters.actorLabel);
  }

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || !users) return [];
    return users
      .filter(
        (u) =>
          u.username.toLowerCase().includes(q) || (u.characterName ?? "").toLowerCase().includes(q)
      )
      .slice(0, 8);
  }, [query, users]);

  const pick = (u: UserOption) => {
    onChange({
      ...filters,
      actorUserId: u.id,
      actorCharacterId: "",
      actorLabel: u.characterName ? `${u.username} / ${u.characterName}` : u.username,
    });
    setQuery(u.characterName ? `${u.username} / ${u.characterName}` : u.username);
    setOpen(false);
  };

  const clear = () => {
    onChange({ ...filters, actorUserId: "", actorCharacterId: "", actorLabel: "" });
    setQuery("");
    setOpen(false);
  };

  const selected = Boolean(filters.actorUserId);

  return (
    <div ref={boxRef} className="relative">
      <div className="relative">
        <svg
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted/70"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
          aria-hidden
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z"
          />
        </svg>
        <input
          type="text"
          value={query}
          placeholder="Actor — search player / character…"
          onFocus={() => {
            ensureLoaded();
            setOpen(true);
          }}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            // Typing invalidates a previously resolved actor.
            if (filters.actorUserId) {
              onChange({ ...filters, actorUserId: "", actorCharacterId: "", actorLabel: "" });
            }
          }}
          className={`${INPUT_CLS} w-64 pl-9 ${selected ? "border-primary/50 ring-2 ring-primary/25" : ""}`}
        />
        {query && (
          <button
            type="button"
            onClick={clear}
            aria-label="Clear actor"
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted transition-colors hover:bg-card-elevated hover:text-foreground motion-reduce:transition-none"
          >
            ✕
          </button>
        )}
      </div>
      {open && query.trim() && (
        <div className="absolute z-30 mt-1.5 w-72 overflow-hidden rounded-lg border border-card-border bg-card shadow-panel">
          {loading && !users ? (
            <div className="px-3 py-2.5 text-xs text-muted">Loading players…</div>
          ) : matches.length === 0 ? (
            <div className="px-3 py-2.5 text-xs text-muted">No matching players.</div>
          ) : (
            <ul className="max-h-64 overflow-y-auto py-1">
              {matches.map((u) => (
                <li key={u.id}>
                  <button
                    type="button"
                    onClick={() => pick(u)}
                    className="flex w-full flex-col items-start px-3 py-2 text-left transition-colors hover:bg-card-elevated motion-reduce:transition-none"
                  >
                    <span className="text-sm font-medium">{u.username}</span>
                    {u.characterName && (
                      <span className="text-xs text-muted">{u.characterName}</span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function activeChips(filters: AuditFilterState): { key: keyof AuditFilterState; label: string }[] {
  const chips: { key: keyof AuditFilterState; label: string }[] = [];
  if (filters.actorUserId || filters.actorCharacterId)
    chips.push({ key: "actorUserId", label: `Actor: ${filters.actorLabel || "selected"}` });
  if (filters.category) chips.push({ key: "category", label: `Category: ${filters.category}` });
  if (filters.action) chips.push({ key: "action", label: `Action: ${filters.action}` });
  if (filters.subjectType)
    chips.push({ key: "subjectType", label: `Subject: ${filters.subjectType}` });
  if (filters.subjectId)
    chips.push({ key: "subjectId", label: `Subject id: ${filters.subjectId}` });
  if (filters.outcome) chips.push({ key: "outcome", label: `Outcome: ${filters.outcome}` });
  if (filters.flag) chips.push({ key: "flag", label: `Flag: ${filters.flag}` });
  if (filters.flaggedOnly) chips.push({ key: "flaggedOnly", label: "Flagged only" });
  if (filters.turnFrom) chips.push({ key: "turnFrom", label: `Turn ≥ ${filters.turnFrom}` });
  if (filters.turnTo) chips.push({ key: "turnTo", label: `Turn ≤ ${filters.turnTo}` });
  if (filters.tsFrom) chips.push({ key: "tsFrom", label: `From ${filters.tsFrom}` });
  if (filters.tsTo) chips.push({ key: "tsTo", label: `To ${filters.tsTo}` });
  return chips;
}

export function AuditFilters({
  filters,
  onChange,
  onReset,
  apiBase,
  knownFlags,
}: AuditFiltersProps) {
  const [showMore, setShowMore] = useState(false);
  const set = (patch: Partial<AuditFilterState>) => onChange({ ...filters, ...patch });

  const clearChip = (key: keyof AuditFilterState) => {
    if (key === "actorUserId") {
      set({ actorUserId: "", actorCharacterId: "", actorLabel: "" });
    } else if (key === "flaggedOnly") {
      set({ flaggedOnly: false });
    } else {
      set({ [key]: "" } as Partial<AuditFilterState>);
    }
  };

  const flagOptions = useMemo(() => {
    const s = new Set(knownFlags);
    if (filters.flag) s.add(filters.flag);
    return Array.from(s).sort();
  }, [knownFlags, filters.flag]);

  const chips = activeChips(filters);

  return (
    <div className="space-y-2">
      {/* Primary row */}
      <div className="flex flex-wrap items-center gap-2">
        <ActorSearch filters={filters} onChange={onChange} apiBase={apiBase} />

        <select
          value={filters.category}
          onChange={(e) => set({ category: e.target.value })}
          className={INPUT_CLS}
        >
          <option value="">All categories</option>
          {CATEGORY_OPTIONS.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>

        <select
          value={filters.outcome}
          onChange={(e) => set({ outcome: e.target.value })}
          className={INPUT_CLS}
        >
          <option value="">Any outcome</option>
          <option value="ok">OK</option>
          <option value="rejected">Rejected</option>
          <option value="error">Error</option>
        </select>

        <button
          type="button"
          onClick={() => set({ flaggedOnly: !filters.flaggedOnly })}
          aria-pressed={filters.flaggedOnly}
          className={`h-10 rounded-lg border px-4 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 motion-reduce:transition-none ${
            filters.flaggedOnly
              ? "border-red-400/40 bg-red-500/15 text-red-400"
              : "border-card-border text-muted hover:border-muted/50 hover:text-foreground"
          }`}
        >
          ⚑ Flagged only
        </button>

        <button
          type="button"
          onClick={() => setShowMore((v) => !v)}
          aria-expanded={showMore}
          className="h-10 rounded-lg border border-card-border px-3 text-sm text-muted transition-colors hover:border-muted/50 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 motion-reduce:transition-none"
        >
          {showMore ? "Fewer filters" : "More filters"}
        </button>
      </div>

      {/* Advanced row */}
      {showMore && (
        <div className="flex flex-wrap items-end gap-3 rounded-xl border border-card-border bg-card/60 p-4">
          <label className="flex flex-col gap-1.5 text-xs font-medium text-muted">
            Subject type
            <input
              type="text"
              value={filters.subjectType}
              placeholder="e.g. corporation"
              onChange={(e) => set({ subjectType: e.target.value })}
              className={`${INPUT_CLS} w-40`}
            />
          </label>
          <label className="flex flex-col gap-1.5 text-xs font-medium text-muted">
            Subject id
            <input
              type="text"
              value={filters.subjectId}
              onChange={(e) => set({ subjectId: e.target.value })}
              className={`${INPUT_CLS} w-44`}
            />
          </label>
          <label className="flex flex-col gap-1.5 text-xs font-medium text-muted">
            Action verb
            <input
              type="text"
              value={filters.action}
              placeholder="e.g. wire.send"
              onChange={(e) => set({ action: e.target.value })}
              className={`${INPUT_CLS} w-44`}
            />
          </label>
          <label className="flex flex-col gap-1.5 text-xs font-medium text-muted">
            Flag
            <select
              value={filters.flag}
              onChange={(e) => set({ flag: e.target.value })}
              className={`${INPUT_CLS} w-44`}
            >
              <option value="">Any flag</option>
              {flagOptions.map((f) => (
                <option key={f} value={f}>
                  {f.replace(/_/g, " ")}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1.5 text-xs font-medium text-muted">
            Turn from
            <input
              type="number"
              value={filters.turnFrom}
              onChange={(e) => set({ turnFrom: e.target.value })}
              className={`${INPUT_CLS} w-24`}
            />
          </label>
          <label className="flex flex-col gap-1.5 text-xs font-medium text-muted">
            Turn to
            <input
              type="number"
              value={filters.turnTo}
              onChange={(e) => set({ turnTo: e.target.value })}
              className={`${INPUT_CLS} w-24`}
            />
          </label>
          <label className="flex flex-col gap-1.5 text-xs font-medium text-muted">
            From date
            <input
              type="date"
              value={filters.tsFrom}
              onChange={(e) => set({ tsFrom: e.target.value })}
              className={INPUT_CLS}
            />
          </label>
          <label className="flex flex-col gap-1.5 text-xs font-medium text-muted">
            To date
            <input
              type="date"
              value={filters.tsTo}
              onChange={(e) => set({ tsTo: e.target.value })}
              className={INPUT_CLS}
            />
          </label>
        </div>
      )}

      {/* Active-filter chips */}
      {chips.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {chips.map((c) => (
            <button
              key={c.key}
              type="button"
              onClick={() => clearChip(c.key)}
              title="Remove this filter"
              className="inline-flex items-center gap-1.5 rounded-full border border-card-border bg-card px-2.5 py-1 text-xs text-foreground/80 transition-colors hover:border-red-400/40 hover:text-red-400 motion-reduce:transition-none"
            >
              {c.label}
              <span aria-hidden className="text-muted">
                ✕
              </span>
            </button>
          ))}
          <button
            type="button"
            onClick={onReset}
            className="ml-1 rounded text-xs text-muted underline underline-offset-2 transition-colors hover:text-foreground motion-reduce:transition-none"
          >
            Clear all
          </button>
        </div>
      )}
    </div>
  );
}

export { EMPTY_FILTERS };
