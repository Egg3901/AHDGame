"use client";

import { useState, useEffect, useCallback } from "react";
import { CURRENCY_SYMBOLS, type CurrencyCode } from "@/lib/constants/currencies";
import { LocalTime } from "@/components/time/LocalTime";

interface ActivityLogEvent {
  _id: string;
  type:
    | "turn_summary"
    | "fund_event"
    | "login"
    | "logout"
    | "party_change"
    | "character_deleted"
    | "character_recreated"
    | "profile_update"
    | "discord_profile_update"
    | "game_action";
  timestamp: string;
  userId: string;
  username: string;
  characterId?: string;
  characterName?: string;
  countryId?: string;
  // turn_summary
  turnNumber?: number;
  apSpent?: number;
  apTotal?: number;
  actions?: Array<{
    type: string;
    apCost: number;
    targetName?: string;
    targetType?: string;
    result?: {
      fundsChange?: number;
      influenceChange?: number;
      favorabilityChange?: number;
      infamyChange?: number;
    };
  }>;
  // fund_event
  fundEventType?: string;
  amount?: number;
  currencyCode?: CurrencyCode;
  fromName?: string;
  fromType?: string;
  toName?: string;
  toType?: string;
  // login
  ipAddress?: string;
  userAgent?: string;
  fingerprint?: string;
  trackingId?: string;
  // game_action
  actionType?: string;
  actionCost?: number;
  turn?: number;
  targetName?: string;
  targetType?: string;
  result?: {
    success?: boolean;
    fundsChange?: number;
    politicalInfluenceChange?: number;
    message?: string;
  };
  summary?: string;
  details?: Record<string, unknown>;
}

interface Filters {
  type: string;
  country: string;
  search: string;
  from: string;
  to: string;
  flagSeverities: string[];
}

const COUNTRY_OPTIONS = ["", "US", "UK", "DE"];
const TYPE_OPTIONS = [
  { value: "", label: "All types" },
  { value: "turn_summary", label: "Turn summary" },
  { value: "fund_event", label: "Fund event" },
  { value: "login", label: "Login" },
  { value: "logout", label: "Logout" },
  { value: "party_change", label: "Party change" },
  { value: "character_deleted", label: "Character deleted" },
  { value: "character_recreated", label: "Character recreated" },
  { value: "profile_update", label: "Profile update" },
  { value: "discord_profile_update", label: "Discord profile update" },
  { value: "game_action", label: "Game action" },
];

const INPUT_CLS =
  "min-h-[40px] rounded border border-card-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary";

function EventSummary({ event, isMod }: { event: ActivityLogEvent; isMod: boolean }) {
  if (event.type === "turn_summary") {
    return (
      <span>
        Turn {event.turnNumber} — spent {event.apSpent}/{event.apTotal} AP (
        {event.actions?.length ?? 0} actions)
      </span>
    );
  }
  if (event.type === "fund_event") {
    // Pre-2026-05-18 rows have no currencyCode; fall back to ₳ for those.
    const symbol = event.currencyCode ? CURRENCY_SYMBOLS[event.currencyCode] : "₳";
    return (
      <span>
        {event.fundEventType?.replace("_", " ")} — {symbol}
        {event.amount?.toLocaleString("en-US")} from {event.fromName} ({event.fromType}) →{" "}
        {event.toName} ({event.toType})
      </span>
    );
  }
  if (event.type === "login") {
    return <span>{isMod ? "Login" : `Login from ${event.ipAddress ?? "unknown IP"}`}</span>;
  }
  if (event.type === "logout") {
    return <span>Logout</span>;
  }
  if (event.type === "game_action") {
    return (
      <span>
        {event.actionType} (turn {event.turn}) — {event.result?.message}
      </span>
    );
  }
  if (
    event.type === "party_change" ||
    event.type === "character_deleted" ||
    event.type === "character_recreated" ||
    event.type === "profile_update" ||
    event.type === "discord_profile_update"
  ) {
    return <span>{event.summary ?? "Profile/activity change"}</span>;
  }
  return null;
}

function EventDetail({ event, isMod }: { event: ActivityLogEvent; isMod: boolean }) {
  if (event.type === "turn_summary" && event.actions) {
    return (
      <div className="mt-2 space-y-1 text-xs text-muted">
        {event.actions.map((a, i) => (
          <div key={i} className="flex gap-2">
            <span className="font-medium text-foreground">{a.type}</span>
            <span>({a.apCost} AP)</span>
            {a.targetName && (
              <span>
                → {a.targetName} [{a.targetType}]
              </span>
            )}
            {a.result?.fundsChange && (
              <span className={a.result.fundsChange > 0 ? "text-green-500" : "text-red-500"}>
                {a.result.fundsChange > 0 ? "+" : ""}₳{a.result.fundsChange.toLocaleString("en-US")}
              </span>
            )}
          </div>
        ))}
      </div>
    );
  }
  if (event.type === "login") {
    if (isMod) {
      return (
        <div className="mt-2 text-xs text-muted">
          <div className="truncate max-w-lg">
            Tracking cookie: {event.trackingId ? "present" : "--"}
          </div>
        </div>
      );
    }
    return (
      <div className="mt-2 text-xs text-muted">
        <div className="truncate max-w-lg">Fingerprint: {event.fingerprint ?? "--"}</div>
        <div className="truncate max-w-lg">Tracking: {event.trackingId ?? "--"}</div>
        <div>IP: {event.ipAddress ?? "—"}</div>
        <div className="truncate max-w-lg">UA: {event.userAgent ?? "—"}</div>
      </div>
    );
  }
  if (event.type === "game_action") {
    return (
      <div className="mt-2 space-y-0.5 text-xs text-muted">
        <div>Cost: {event.actionCost} AP</div>
        {event.targetName && (
          <div>
            Target: {event.targetName} {event.targetType ? `(${event.targetType})` : ""}
          </div>
        )}
        {event.result?.fundsChange != null && (
          <div className={event.result.fundsChange >= 0 ? "text-green-500" : "text-red-500"}>
            Funds: {event.result.fundsChange >= 0 ? "+" : ""}
            {event.result.fundsChange.toLocaleString("en-US")}
          </div>
        )}
        {event.details && Object.keys(event.details).length > 0 && (
          <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded bg-black/20 p-2">
            {JSON.stringify(event.details, null, 2)}
          </pre>
        )}
      </div>
    );
  }
  if (event.details && Object.keys(event.details).length > 0) {
    return (
      <div className="mt-2 text-xs text-muted">
        <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded bg-black/20 p-2">
          {JSON.stringify(event.details, null, 2)}
        </pre>
      </div>
    );
  }
  return null;
}

const TYPE_BADGE: Record<string, string> = {
  turn_summary: "bg-blue-500/10 text-blue-400",
  fund_event: "bg-amber-500/10 text-amber-400",
  login: "bg-green-500/10 text-green-400",
  logout: "bg-gray-500/10 text-gray-400",
  party_change: "bg-violet-500/10 text-violet-400",
  character_deleted: "bg-rose-500/10 text-rose-400",
  character_recreated: "bg-cyan-500/10 text-cyan-400",
  profile_update: "bg-indigo-500/10 text-indigo-400",
  discord_profile_update: "bg-fuchsia-500/10 text-fuchsia-400",
  game_action: "bg-teal-500/10 text-teal-400",
};

export function ActivityLogTab({
  initialCharacterId,
  context = "admin",
}: {
  initialCharacterId?: string;
  context?: "admin" | "moderator";
}) {
  const apiBase = context === "moderator" ? "/api/moderator" : "/api/admin";
  const isModeratorContext = context === "moderator";
  const [events, setEvents] = useState<ActivityLogEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [hasMore, setHasMore] = useState(false);
  // Cursor that loaded each page; index 0 = page 1 = null.
  const [cursorStack, setCursorStack] = useState<(string | null)[]>([null]);
  const [pageNum, setPageNum] = useState(1);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const [filters, setFilters] = useState<Filters>({
    type: "",
    country: "",
    search: "",
    from: sevenDaysAgo,
    to: "",
    flagSeverities: [],
  });
  const [pendingFilters, setPendingFilters] = useState<Filters>(filters);

  const fetchEvents = useCallback(
    async (cursorParam: string | null, currentFilters: Filters): Promise<string | null> => {
      setLoading(true);
      setError("");
      try {
        const params = new URLSearchParams();
        if (currentFilters.type) params.set("type", currentFilters.type);
        if (currentFilters.country) params.set("country", currentFilters.country);
        if (currentFilters.search) params.set("search", currentFilters.search);
        if (currentFilters.from) params.set("from", currentFilters.from);
        if (currentFilters.to) params.set("to", currentFilters.to);
        if (currentFilters.flagSeverities.length > 0)
          params.set("flagSeverity", currentFilters.flagSeverities.join(","));
        if (initialCharacterId) params.set("characterId", initialCharacterId);
        if (cursorParam) params.set("cursor", cursorParam);
        params.set("limit", "25");

        const res = await fetch(`${apiBase}/activity-log?${params}`);
        if (!res.ok) throw new Error(`Request failed: ${res.status}`);
        const data = await res.json();

        setEvents(data.events);
        setHasMore(data.hasMore);
        return (data.nextCursor as string | null) ?? null;
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load events");
        return null;
      } finally {
        setLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [initialCharacterId]
  );

  // Record the cursor that loads page `page+1` (1-based page just loaded).
  const recordNext = (page: number, next: string | null) =>
    setCursorStack((s) => {
      const copy = [...s];
      copy[page] = next;
      return copy;
    });

  useEffect(() => {
    fetchEvents(null, filters).then((next) => recordNext(1, next));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const applyFilters = () => {
    setFilters(pendingFilters);
    setCursorStack([null]);
    setPageNum(1);
    fetchEvents(null, pendingFilters).then((next) => recordNext(1, next));
  };

  const goNext = () => {
    // cursorStack[pageNum] is the current page's nextCursor (set on load).
    const cursorForNext = cursorStack[pageNum] ?? null;
    const target = pageNum + 1;
    fetchEvents(cursorForNext, filters).then((next) => {
      setCursorStack((s) => {
        const copy = [...s];
        copy[target - 1] = cursorForNext;
        copy[target] = next;
        return copy;
      });
      setPageNum(target);
    });
  };

  const goPrev = () => {
    if (pageNum <= 1) return;
    const target = pageNum - 1;
    const cursorForPrev = cursorStack[target - 1] ?? null;
    fetchEvents(cursorForPrev, filters).then((next) => {
      recordNext(target, next);
      setPageNum(target);
    });
  };

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  return (
    <div className="space-y-4">
      <h2 className="text-base font-semibold sm:text-lg">Activity Log</h2>

      {/* Filter bar */}
      <div className="flex flex-wrap gap-2">
        <input
          type="text"
          placeholder="Search username / character..."
          value={pendingFilters.search}
          onChange={(e) => setPendingFilters((p) => ({ ...p, search: e.target.value }))}
          onKeyDown={(e) => e.key === "Enter" && applyFilters()}
          className={`${INPUT_CLS} w-52`}
        />
        <select
          value={pendingFilters.type}
          onChange={(e) => setPendingFilters((p) => ({ ...p, type: e.target.value }))}
          className={INPUT_CLS}
        >
          {TYPE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <select
          value={pendingFilters.country}
          onChange={(e) => setPendingFilters((p) => ({ ...p, country: e.target.value }))}
          className={INPUT_CLS}
        >
          {COUNTRY_OPTIONS.map((c) => (
            <option key={c} value={c}>
              {c || "All countries"}
            </option>
          ))}
        </select>
        <input
          type="date"
          value={pendingFilters.from}
          onChange={(e) => setPendingFilters((p) => ({ ...p, from: e.target.value }))}
          className={INPUT_CLS}
        />
        <span className="self-center text-muted text-sm">to</span>
        <input
          type="date"
          value={pendingFilters.to}
          onChange={(e) => setPendingFilters((p) => ({ ...p, to: e.target.value }))}
          className={INPUT_CLS}
        />
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted">Flags:</span>
          {(["high", "medium", "low"] as const).map((sev) => {
            const active = pendingFilters.flagSeverities.includes(sev);
            return (
              <button
                key={sev}
                type="button"
                onClick={() =>
                  setPendingFilters((p) => ({
                    ...p,
                    flagSeverities: active
                      ? p.flagSeverities.filter((s) => s !== sev)
                      : [...p.flagSeverities, sev],
                  }))
                }
                className={`min-h-[40px] rounded border px-3 py-2 text-xs font-medium capitalize transition-colors ${
                  active
                    ? sev === "high"
                      ? "border-red-500/40 bg-red-500/15 text-red-400"
                      : sev === "medium"
                        ? "border-amber-500/40 bg-amber-500/15 text-amber-400"
                        : "border-blue-500/40 bg-blue-500/15 text-blue-400"
                    : "border-card-border text-muted hover:text-foreground"
                }`}
              >
                {sev}
              </button>
            );
          })}
        </div>
        <button
          onClick={applyFilters}
          disabled={loading}
          className="min-h-[40px] rounded bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          Search
        </button>
      </div>

      {error && <p className="text-sm text-red-500">{error}</p>}

      {/* Table */}
      <div className="rounded-xl border border-card-border bg-card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-card-border bg-card/50">
            <tr>
              <th className="px-4 py-3 text-left font-medium text-muted">Timestamp</th>
              <th className="px-4 py-3 text-left font-medium text-muted">Type</th>
              <th className="px-4 py-3 text-left font-medium text-muted">User / Character</th>
              <th className="px-4 py-3 text-left font-medium text-muted hidden sm:table-cell">
                Country
              </th>
              <th className="px-4 py-3 text-left font-medium text-muted">Summary</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-card-border">
            {events.length === 0 && !loading && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-muted text-sm">
                  No events found.
                </td>
              </tr>
            )}
            {events.map((event) => {
              const expanded = expandedIds.has(event._id);
              return (
                <tr
                  key={event._id}
                  className="cursor-pointer hover:bg-card/80 transition-colors"
                  onClick={() => toggleExpand(event._id)}
                >
                  <td className="px-4 py-3 text-xs text-muted whitespace-nowrap">
                    <LocalTime value={event.timestamp} />
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded px-2 py-0.5 text-xs font-medium ${TYPE_BADGE[event.type] ?? ""}`}
                    >
                      {event.type.replace("_", " ")}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {isModeratorContext ? (
                      <div className="font-medium">
                        {event.characterName ?? <span className="text-muted italic">Unknown</span>}
                      </div>
                    ) : (
                      <>
                        <div className="font-medium">{event.username}</div>
                        {event.characterName && (
                          <div className="text-xs text-muted">{event.characterName}</div>
                        )}
                      </>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted hidden sm:table-cell">
                    {event.countryId ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-xs">
                    <EventSummary event={event} isMod={isModeratorContext} />
                    {expanded && <EventDetail event={event} isMod={isModeratorContext} />}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between">
        <p className="text-xs text-muted">Page {pageNum}</p>
        <div className="flex gap-2">
          <button
            onClick={goPrev}
            disabled={pageNum <= 1 || loading}
            className="min-h-[40px] rounded border border-card-border px-4 py-2 text-sm font-medium hover:bg-card disabled:opacity-40"
          >
            ← Previous
          </button>
          <button
            onClick={goNext}
            disabled={!hasMore || loading}
            className="min-h-[40px] rounded border border-card-border px-4 py-2 text-sm font-medium hover:bg-card disabled:opacity-40"
          >
            Next →
          </button>
        </div>
      </div>
    </div>
  );
}
