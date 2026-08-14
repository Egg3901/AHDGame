"use client";

import Link from "next/link";
import { ChevronDown } from "lucide-react";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui";
import { LocalTime } from "@/components/time/LocalTime";

type LeaderRow = {
  userId: string;
  username: string;
  displayName: string;
  count: number;
};

type RefereeRow = {
  userId: string;
  username: string;
  displayName: string;
  profileHref: string;
};

type ViewMode = "allTime" | "contest";

export function ReferralLeaderboardPanel() {
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>("allTime");
  const [contestMode, setContestMode] = useState(false);
  const [contestStartedAt, setContestStartedAt] = useState<string | null>(null);
  const [allTime, setAllTime] = useState<LeaderRow[]>([]);
  const [contest, setContest] = useState<LeaderRow[]>([]);

  const [expandedUserId, setExpandedUserId] = useState<string | null>(null);
  const [refereesByKey, setRefereesByKey] = useState<Record<string, RefereeRow[]>>({});
  const refereesByKeyRef = useRef(refereesByKey);
  refereesByKeyRef.current = refereesByKey;
  const [refereesLoadingUserId, setRefereesLoadingUserId] = useState<string | null>(null);
  const [refereesError, setRefereesError] = useState("");

  const fetchData = useCallback(async () => {
    setError("");
    try {
      const res = await fetch("/api/admin/referrals/leaderboard");
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(typeof data.error === "string" ? data.error : "Failed to load referral data");
        return;
      }
      const data = await res.json();
      setContestMode(!!data.contestMode);
      setContestStartedAt(typeof data.contestStartedAt === "string" ? data.contestStartedAt : null);
      setAllTime(Array.isArray(data.allTime) ? data.allTime : []);
      setContest(Array.isArray(data.contest) ? data.contest : []);
      setExpandedUserId(null);
      setRefereesByKey({});
      setRefereesError("");
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const displayRows = viewMode === "allTime" ? allTime : contest;

  const rankMap = useMemo(() => {
    let rank = 1;
    return displayRows.map((row, i) => {
      if (i > 0 && row.count < displayRows[i - 1].count) {
        rank = i + 1;
      }
      return { row, rank };
    });
  }, [displayRows]);

  const cacheKey = useCallback((userId: string) => `${userId}:${viewMode}`, [viewMode]);

  const loadReferees = useCallback(
    async (userId: string) => {
      const key = `${userId}:${viewMode}`;
      if (refereesByKeyRef.current[key] !== undefined) return;

      setRefereesLoadingUserId(userId);
      setRefereesError("");
      try {
        const modeParam = viewMode === "contest" ? "contest" : "allTime";
        const res = await fetch(`/api/admin/referrals/by-user/${userId}?mode=${modeParam}`);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setRefereesError(typeof data.error === "string" ? data.error : "Failed to load referees");
          return;
        }
        const list = Array.isArray(data.referees) ? data.referees : [];
        setRefereesByKey((prev) => ({ ...prev, [key]: list }));
      } catch {
        setRefereesError("Network error");
      } finally {
        setRefereesLoadingUserId(null);
      }
    },
    [viewMode]
  );

  const toggleRow = (userId: string) => {
    if (expandedUserId === userId) {
      setExpandedUserId(null);
      return;
    }
    setExpandedUserId(userId);
    void loadReferees(userId);
  };

  useEffect(() => {
    setExpandedUserId(null);
    setRefereesError("");
  }, [viewMode]);

  const handleStartContest = async () => {
    setActionLoading(true);
    setError("");
    try {
      const res = await fetch("/api/admin/referrals/leaderboard", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "start-contest" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof data.error === "string" ? data.error : "Could not start contest");
        return;
      }
      setContestMode(!!data.contestMode);
      setContestStartedAt(typeof data.contestStartedAt === "string" ? data.contestStartedAt : null);
      await fetchData();
      setViewMode("contest");
    } catch {
      setError("Network error");
    } finally {
      setActionLoading(false);
    }
  };

  const handleResetContest = async () => {
    setActionLoading(true);
    setError("");
    try {
      const res = await fetch("/api/admin/referrals/leaderboard", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reset-contest" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof data.error === "string" ? data.error : "Could not reset contest");
        return;
      }
      setContestMode(!!data.contestMode);
      setContestStartedAt(null);
      await fetchData();
    } catch {
      setError("Network error");
    } finally {
      setActionLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="rounded-xl border border-card-border bg-card p-6 shadow-card">
        <div className="flex items-center gap-2">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <span className="text-sm text-muted">Loading referral rankings…</span>
        </div>
      </div>
    );
  }

  const emptyMessage =
    viewMode === "allTime"
      ? "No referrals recorded yet."
      : "No contest referrals yet — invite players to climb the board.";

  return (
    <div className="rounded-xl border border-card-border bg-card p-6 shadow-card">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="text-heading-sm font-semibold text-foreground">Referral tracker</h3>
          <p className="mt-1 text-body-sm text-muted">
            Rankings count completed referrals — when an invited player finishes character setup.
          </p>
          {contestMode && contestStartedAt != null && (
            <p className="mt-2 text-body-xs text-muted">
              Contest tracking since{" "}
              <span className="font-medium text-foreground">
                <LocalTime
                  value={contestStartedAt}
                  options={{ dateStyle: "medium", timeStyle: "short" }}
                />
              </span>
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            className="min-w-0"
            onClick={() => fetchData()}
            disabled={actionLoading}
          >
            Refresh
          </Button>
          {contestMode ? (
            <Button variant="secondary" onClick={handleResetContest} isLoading={actionLoading}>
              End &amp; reset contest
            </Button>
          ) : (
            <Button variant="primary" onClick={handleStartContest} isLoading={actionLoading}>
              Start new contest
            </Button>
          )}
        </div>
      </div>

      <div className="mb-4 flex flex-wrap gap-2 rounded-lg border border-card-border bg-card-muted/30 p-1">
        <button
          type="button"
          onClick={() => setViewMode("allTime")}
          className={`rounded-md px-3 py-2 text-body-sm font-medium transition-colors ${
            viewMode === "allTime"
              ? "bg-card text-foreground shadow-sm"
              : "text-muted hover:text-foreground"
          }`}
        >
          All-time
        </button>
        <button
          type="button"
          onClick={() => setViewMode("contest")}
          className={`rounded-md px-3 py-2 text-body-sm font-medium transition-colors ${
            viewMode === "contest"
              ? "bg-card text-foreground shadow-sm"
              : "text-muted hover:text-foreground"
          }`}
        >
          Contest (rolling)
        </button>
      </div>

      {error ? <p className="mb-4 text-body-sm text-error">{error}</p> : null}

      {viewMode === "contest" && !contestMode ? (
        <div className="rounded-lg border border-dashed border-card-border bg-background/40 p-6 text-center">
          <p className="text-body-sm text-muted">
            Contest mode is off. Start a contest to track referrals from a new baseline and
            determine a winner.
          </p>
          <Button
            className="mt-4"
            variant="primary"
            onClick={handleStartContest}
            isLoading={actionLoading}
          >
            Start new contest
          </Button>
        </div>
      ) : (
        <div className="rounded-xl border border-card-border bg-card overflow-hidden shadow-sm">
          {/* Desktop */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-background/50">
                <tr>
                  <th className="w-10 px-2 py-3" aria-hidden />
                  <th className="px-4 py-3 text-left text-xs font-medium text-muted uppercase tracking-wider">
                    #
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-muted uppercase tracking-wider">
                    Player
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-muted uppercase tracking-wider">
                    Referrals
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-card-border">
                {rankMap.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-8 text-center text-muted">
                      {emptyMessage}
                    </td>
                  </tr>
                ) : (
                  rankMap.map(({ row, rank }) => {
                    const open = expandedUserId === row.userId;
                    const key = cacheKey(row.userId);
                    const referees = refereesByKey[key];
                    const loadingRefs =
                      refereesLoadingUserId === row.userId && referees === undefined;

                    return (
                      <Fragment key={row.userId}>
                        <tr className="hover:bg-background/40 transition-colors duration-150">
                          <td className="px-2 py-3 align-middle">
                            <button
                              type="button"
                              onClick={() => toggleRow(row.userId)}
                              className="flex h-9 w-9 items-center justify-center rounded-lg text-muted hover:bg-card-muted/50 hover:text-foreground"
                              aria-expanded={open}
                              aria-label={
                                open ? "Collapse referred players" : "Expand referred players"
                              }
                            >
                              <ChevronDown
                                className={`h-4 w-4 shrink-0 transition-transform duration-200 ${
                                  open ? "rotate-180" : ""
                                }`}
                              />
                            </button>
                          </td>
                          <td className="px-4 py-3 align-middle">
                            <span className="tabular-nums font-medium text-muted">{rank}</span>
                          </td>
                          <td className="px-4 py-3 align-middle">
                            <button
                              type="button"
                              onClick={() => toggleRow(row.userId)}
                              className="w-full min-w-0 text-left"
                            >
                              <p className="truncate font-medium text-foreground">
                                {row.displayName}
                              </p>
                              <p className="truncate text-body-xs text-muted">@{row.username}</p>
                            </button>
                          </td>
                          <td className="px-4 py-3 align-middle">
                            <button
                              type="button"
                              onClick={() => toggleRow(row.userId)}
                              className="w-full text-left"
                            >
                              <span className="tabular-nums font-semibold text-foreground">
                                {row.count}
                              </span>
                            </button>
                          </td>
                        </tr>
                        {open ? (
                          <tr className="bg-background/30">
                            <td colSpan={4} className="border-t border-card-border px-4 py-3">
                              {refereesError && expandedUserId === row.userId ? (
                                <p className="text-body-sm text-error">{refereesError}</p>
                              ) : loadingRefs ? (
                                <div className="flex items-center gap-2 text-body-sm text-muted">
                                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                                  Loading referred players…
                                </div>
                              ) : referees && referees.length === 0 ? (
                                <p className="text-body-sm text-muted">
                                  No referred players match this view (profiles appear after
                                  character setup).
                                </p>
                              ) : (
                                <ul className="max-h-72 space-y-2 overflow-y-auto pr-1">
                                  {(referees ?? []).map((r) => (
                                    <li key={r.userId}>
                                      <Link
                                        href={r.profileHref}
                                        className="inline-flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-body-sm text-secondary hover:text-secondary/80 hover:underline"
                                      >
                                        <span className="font-medium text-foreground">
                                          {r.displayName}
                                        </span>
                                        <span className="text-muted">@{r.username}</span>
                                      </Link>
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </td>
                          </tr>
                        ) : null}
                      </Fragment>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Mobile */}
          <div className="md:hidden divide-y divide-card-border">
            {rankMap.length === 0 ? (
              <div className="px-4 py-8 text-center text-muted">{emptyMessage}</div>
            ) : (
              rankMap.map(({ row, rank }) => {
                const open = expandedUserId === row.userId;
                const key = cacheKey(row.userId);
                const referees = refereesByKey[key];
                const loadingRefs = refereesLoadingUserId === row.userId && referees === undefined;

                return (
                  <div key={row.userId} className="p-4">
                    <button
                      type="button"
                      onClick={() => toggleRow(row.userId)}
                      className="flex w-full items-start gap-3 text-left"
                      aria-expanded={open}
                    >
                      <ChevronDown
                        className={`mt-0.5 h-4 w-4 shrink-0 text-muted transition-transform duration-200 ${
                          open ? "rotate-180" : ""
                        }`}
                      />
                      <div className="min-w-0 flex-1 space-y-3">
                        <div className="flex flex-col gap-0.5">
                          <span className="text-xs font-medium text-muted uppercase tracking-wider">
                            Rank
                          </span>
                          <span className="tabular-nums font-medium text-muted">{rank}</span>
                        </div>
                        <div className="flex flex-col gap-0.5">
                          <span className="text-xs font-medium text-muted uppercase tracking-wider">
                            Player
                          </span>
                          <div>
                            <p className="truncate font-medium text-foreground">
                              {row.displayName}
                            </p>
                            <p className="truncate text-body-xs text-muted">@{row.username}</p>
                          </div>
                        </div>
                        <div className="flex flex-col gap-0.5">
                          <span className="text-xs font-medium text-muted uppercase tracking-wider">
                            Referrals
                          </span>
                          <span className="tabular-nums font-semibold text-foreground">
                            {row.count}
                          </span>
                        </div>
                      </div>
                    </button>
                    {open ? (
                      <div className="mt-4 border-t border-card-border pt-4 pl-7">
                        {refereesError && expandedUserId === row.userId ? (
                          <p className="text-body-sm text-error">{refereesError}</p>
                        ) : loadingRefs ? (
                          <div className="flex items-center gap-2 text-body-sm text-muted">
                            <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                            Loading referred players…
                          </div>
                        ) : referees && referees.length === 0 ? (
                          <p className="text-body-sm text-muted">
                            No referred players match this view (profiles appear after character
                            setup).
                          </p>
                        ) : (
                          <ul className="max-h-72 space-y-2 overflow-y-auto">
                            {(referees ?? []).map((r) => (
                              <li key={r.userId}>
                                <Link
                                  href={r.profileHref}
                                  className="inline-flex flex-wrap items-baseline gap-x-2 text-body-sm text-secondary hover:text-secondary/80 hover:underline"
                                >
                                  <span className="font-medium text-foreground">
                                    {r.displayName}
                                  </span>
                                  <span className="text-muted">@{r.username}</span>
                                </Link>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    ) : null}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
