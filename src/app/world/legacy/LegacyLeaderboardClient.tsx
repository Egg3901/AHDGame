"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Crown, Trophy, Info } from "lucide-react";
import { fetchJson } from "@/lib/observability/fetchJson";
import { ResponsiveTable, type ResponsiveTableColumn } from "@/components/ui/ResponsiveTable";
import { EmptyState } from "@/components/ui/EmptyState";
import { Avatar } from "@/components/Avatar";
import { CountryFlag } from "@/components/CountryFlag";
import { Badge } from "@/components/ui/Badge";
import { Modal } from "@/components/ui/Modal";
import { formatCompactNumber } from "@/lib/utils/formatters";
import type {
  LegacyLeaderboardData,
  LegacyLeaderboardEntry,
  LegacyLeaderboardScope,
  LegacyRankBy,
} from "@/lib/world/legacyLeaderboardTypes";

interface LegacyLeaderboardClientProps {
  data: LegacyLeaderboardData;
  total: number;
  selfUserId: string | null;
  initialScope: LegacyLeaderboardScope;
  initialRankBy: LegacyRankBy;
}

const MEDAL_BY_RANK: Record<number, string> = { 1: "🥇", 2: "🥈", 3: "🥉" };

const SCORE_BREAKDOWN_ROWS: {
  key: keyof LegacyLeaderboardEntry["scoreBreakdown"];
  label: string;
}[] = [
  { key: "nationalInfluence", label: "National Influence" },
  { key: "partyInfluence", label: "Party Power" },
  { key: "achievements", label: "Achievements" },
  { key: "officeTier", label: "Highest Office Held" },
  { key: "wealth", label: "Personal Wealth" },
  { key: "infamyPenalty", label: "Infamy Penalty" },
];

/** ₳ is this game's internal-currency symbol — see formatters.ts. Net worth is forex-normalized to it so amounts are comparable across countries. */
function formatNetWorth(value: number): string {
  return value < 0 ? `-₳${formatCompactNumber(Math.abs(value))}` : `₳${formatCompactNumber(value)}`;
}

function RankCell({ rank }: { rank: number }) {
  const medal = MEDAL_BY_RANK[rank];

  return (
    <div className="flex items-center justify-center md:justify-start">
      {medal ? (
        <span
          className="flex h-9 w-9 items-center justify-center rounded-full border border-card-border bg-card-elevated text-xl leading-none shadow-sm"
          role="img"
          aria-label={`Rank ${rank}`}
          title={`Rank ${rank}`}
        >
          {medal}
        </span>
      ) : (
        <span
          className="flex h-8 min-w-8 items-center justify-center rounded-full border border-card-border bg-card px-2 font-mono text-xs font-bold text-muted"
          aria-label={`Rank ${rank}`}
        >
          {rank}
        </span>
      )}
    </div>
  );
}

function ScoreBreakdownModal({
  row,
  rankBy,
  onClose,
}: {
  row: LegacyLeaderboardEntry | null;
  rankBy: LegacyRankBy;
  onClose: () => void;
}) {
  const isNetWorth = rankBy === "netWorth";

  return (
    <Modal
      open={row !== null}
      onClose={onClose}
      title={row ? `${row.displayName}'s ${isNetWorth ? "Net Worth" : "Legacy Score"}` : ""}
      maxWidthClass="max-w-sm"
    >
      {row &&
        (isNetWorth ? (
          <div className="space-y-1">
            {(
              [
                { key: "personal", label: "Personal Wealth" },
                { key: "savings", label: "Savings" },
                { key: "shares", label: "Corporation Shares" },
                { key: "bonds", label: "Bonds" },
                { key: "indexFunds", label: "Index Fund Positions" },
              ] as const
            ).map(({ key, label }) => (
              <div key={key} className="flex items-center justify-between py-1.5 text-sm">
                <span className="text-muted">{label}</span>
                <span className="font-mono font-medium text-foreground">
                  {formatNetWorth(row.netWorthBreakdown[key])}
                </span>
              </div>
            ))}
            <div className="mt-2 flex items-center justify-between border-t border-card-border pt-2 text-sm font-semibold">
              <span className="text-foreground">Total Net Worth</span>
              <span className="font-mono text-foreground">{formatNetWorth(row.netWorth)}</span>
            </div>
            <p className="mt-2 text-xs text-muted">
              Forex-normalized so amounts are comparable across countries. Reflects the balance at
              retirement (or now, if still active) — not necessarily the highest this life ever held
              mid-game.
            </p>
          </div>
        ) : (
          <div className="space-y-1">
            {SCORE_BREAKDOWN_ROWS.map(({ key, label }) => {
              const value = row.scoreBreakdown[key];
              return (
                <div key={key} className="flex items-center justify-between py-1.5 text-sm">
                  <span className="text-muted">{label}</span>
                  <span
                    className={`font-mono font-medium ${value < 0 ? "text-error" : "text-foreground"}`}
                  >
                    {value === 0 ? "0" : `${value > 0 ? "+" : ""}${formatCompactNumber(value)}`}
                  </span>
                </div>
              );
            })}
            <div className="mt-2 flex items-center justify-between border-t border-card-border pt-2 text-sm font-semibold">
              <span className="text-foreground">Total Legacy Score</span>
              <span className="font-mono text-foreground">{formatCompactNumber(row.score)}</span>
            </div>
          </div>
        ))}
    </Modal>
  );
}

function buildLegacyUrl(scope: LegacyLeaderboardScope, rankBy: LegacyRankBy): string {
  const params = new URLSearchParams();
  if (scope === "current") params.set("scope", "current");
  if (rankBy === "netWorth") params.set("rankBy", "netWorth");
  const qs = params.toString();
  return qs ? `/world/legacy?${qs}` : "/world/legacy";
}

export default function LegacyLeaderboardClient({
  data,
  total,
  selfUserId,
  initialScope,
  initialRankBy,
}: LegacyLeaderboardClientProps) {
  const router = useRouter();
  const [entries, setEntries] = useState(data.entries);
  const [totalCount, setTotalCount] = useState(total);
  const [self, setSelf] = useState(data.self);
  const [pendingChoice, setPendingChoice] = useState(self?.displayPreference ?? "");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [scope, setScope] = useState<LegacyLeaderboardScope>(initialScope);
  const [rankBy, setRankBy] = useState<LegacyRankBy>(initialRankBy);
  const [loading, setLoading] = useState(false);
  const [breakdownRow, setBreakdownRow] = useState<LegacyLeaderboardEntry | null>(null);

  async function refetch(nextScope: LegacyLeaderboardScope, nextRankBy: LegacyRankBy) {
    const refreshed = await fetchJson<LegacyLeaderboardData>(
      `/api/v1/leaderboard/legacy?limit=50&scope=${nextScope}&rankBy=${nextRankBy}`,
      { feature: "legacy-leaderboard-refresh" }
    );
    setEntries(refreshed.entries);
    setTotalCount(refreshed.total);
    setSelf(refreshed.self);
  }

  async function changeScope(nextScope: LegacyLeaderboardScope) {
    if (nextScope === scope) return;
    setScope(nextScope);
    setLoading(true);
    router.replace(buildLegacyUrl(nextScope, rankBy), { scroll: false });
    try {
      await refetch(nextScope, rankBy);
    } finally {
      setLoading(false);
    }
  }

  async function changeRankBy(nextRankBy: LegacyRankBy) {
    if (nextRankBy === rankBy) return;
    setRankBy(nextRankBy);
    setLoading(true);
    router.replace(buildLegacyUrl(scope, nextRankBy), { scroll: false });
    try {
      await refetch(scope, nextRankBy);
    } finally {
      setLoading(false);
    }
  }

  async function saveDisplayName() {
    setSaving(true);
    setSaveError(null);
    try {
      await fetchJson("/api/settings/legacy-display-name", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ characterId: pendingChoice || null }),
        feature: "legacy-leaderboard-display-name",
      });
      await refetch(scope, rankBy);
    } catch {
      setSaveError("Couldn't save — try again.");
    } finally {
      setSaving(false);
    }
  }

  const isNetWorth = rankBy === "netWorth";

  const columns: ResponsiveTableColumn<LegacyLeaderboardEntry>[] = [
    {
      key: "rank",
      header: "#",
      mobileLabel: "Rank",
      render: (row) => <RankCell rank={row.rank} />,
    },
    {
      key: "player",
      header: "Player",
      render: (row) => (
        <div className="flex items-center gap-2 min-w-0">
          <Avatar url={row.avatarUrl} name={row.displayName} size="h-8 w-8" />
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="font-medium text-foreground truncate">{row.displayName}</span>
              {row.isActive && (
                <Badge color="success" variant="subtle">
                  Active
                </Badge>
              )}
              {row.userId === selfUserId && (
                <Badge color="primary" variant="subtle">
                  You
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-1 text-xs text-muted">
              <CountryFlag country={row.countryId} size="sm" />
              <span>{row.iterationLabel}</span>
            </div>
          </div>
        </div>
      ),
    },
    {
      key: "score",
      header: isNetWorth ? "Net Worth" : "Legacy Score",
      render: (row) => (
        <button
          type="button"
          onClick={() => setBreakdownRow(row)}
          className="group flex items-center gap-1 font-mono font-semibold text-foreground hover:text-primary"
          aria-label={`View ${isNetWorth ? "net worth" : "score"} breakdown for ${row.displayName}`}
        >
          {isNetWorth ? formatNetWorth(row.netWorth) : formatCompactNumber(row.score)}
          <Info className="h-3.5 w-3.5 text-muted group-hover:text-primary" aria-hidden="true" />
        </button>
      ),
    },
    {
      key: "nationalInfluence",
      header: "National Influence",
      hideOnMobile: true,
      render: (row) => (
        <span className="text-sm text-muted">{formatCompactNumber(row.nationalInfluence)}</span>
      ),
    },
    {
      key: "partyInfluence",
      header: "Party Power",
      hideOnMobile: true,
      render: (row) => (
        <span className="text-sm text-muted">{formatCompactNumber(row.partyInfluence)}</span>
      ),
    },
    {
      key: "office",
      header: "Highest Office",
      hideOnMobile: true,
      render: (row) => <span className="text-sm text-muted">{row.highestOffice ?? "—"}</span>,
    },
    {
      key: "achievements",
      header: "Achievements",
      hideOnMobile: true,
      render: (row) => <span className="text-sm text-muted">{row.achievementCount}</span>,
    },
    {
      key: "lives",
      header: "Lives",
      hideOnMobile: true,
      render: (row) => <span className="text-sm text-muted">{row.lifetimeLives}</span>,
    },
  ];

  return (
    <div className="min-h-screen bg-background pb-20">
      <main className="mx-auto max-w-7xl space-y-8 px-4 py-10 sm:px-6 lg:px-8">
        <header className="relative overflow-hidden rounded-2xl border border-card-border bg-card p-6 shadow-card sm:p-8">
          <div
            className="absolute -right-10 -top-10 h-40 w-40 rounded-full bg-primary/10"
            aria-hidden="true"
          />
          <div className="relative max-w-3xl">
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl border border-primary/20 bg-primary/10 text-primary">
              <Trophy className="h-6 w-6" aria-hidden="true" />
            </div>
            <p className="text-body-xs font-semibold uppercase tracking-widest text-primary">
              {scope === "all" ? "Across every iteration" : "This iteration"}
            </p>
            <h1 className="mt-2 text-3xl font-extrabold tracking-tight text-foreground sm:text-4xl">
              Hall of Fame
            </h1>
            <p className="mt-3 max-w-2xl text-base leading-relaxed text-muted">
              Every player, ranked by their single best life — Alpha, Beta, and every iteration
              since. Retiring a character or resetting the world doesn&apos;t erase your legacy.
            </p>
            <p className="mt-2 max-w-2xl text-sm text-muted">
              {isNetWorth
                ? "Net Worth ranks by personal wealth plus savings, forex-normalized so every country is comparable — pure richest-ever bragging rights."
                : "Legacy Score rewards what a life actually built up — national influence, party power, achievements, and the highest office held — not a snapshot of political influence or favorability, which rise and fall day to day."}
            </p>
          </div>
        </header>

        <div className="flex flex-wrap items-center gap-3">
          <div
            className="inline-flex rounded-lg border border-card-border bg-card p-1"
            role="tablist"
            aria-label="Leaderboard ranking"
          >
            {(
              [
                { value: "legacy", label: "Legacy Score" },
                { value: "netWorth", label: "Net Worth" },
              ] as const
            ).map((opt) => (
              <button
                key={opt.value}
                type="button"
                role="tab"
                aria-selected={rankBy === opt.value}
                disabled={loading}
                onClick={() => changeRankBy(opt.value)}
                className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-50 ${
                  rankBy === opt.value
                    ? "bg-primary text-white"
                    : "text-muted hover:bg-card-elevated hover:text-foreground"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <div
            className="inline-flex rounded-lg border border-card-border bg-card p-1"
            role="tablist"
            aria-label="Leaderboard scope"
          >
            {(
              [
                { value: "all", label: "All Time" },
                { value: "current", label: "Current Iteration" },
              ] as const
            ).map((opt) => (
              <button
                key={opt.value}
                type="button"
                role="tab"
                aria-selected={scope === opt.value}
                disabled={loading}
                onClick={() => changeScope(opt.value)}
                className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-50 ${
                  scope === opt.value
                    ? "bg-primary text-white"
                    : "text-muted hover:bg-card-elevated hover:text-foreground"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {self && (
          <section className="rounded-xl border border-card-border bg-card p-5 shadow-card sm:p-6">
            <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex items-center gap-4">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-card-elevated text-primary">
                  {self.rank === 1 ? (
                    <Crown className="h-6 w-6" aria-hidden="true" />
                  ) : (
                    <Trophy className="h-6 w-6" aria-hidden="true" />
                  )}
                </div>
                <div>
                  <p className="text-body-xs font-medium uppercase tracking-wider text-muted">
                    {scope === "all" ? "Your all-time standing" : "Your standing this iteration"}
                  </p>
                  <p className="mt-1 text-xl font-bold text-foreground">
                    {self.rank ? `#${self.rank}` : "Unranked"}
                  </p>
                  {!self.rank && (
                    <p className="mt-0.5 text-sm text-muted">
                      Play a character to enter the Hall of Fame.
                    </p>
                  )}
                </div>
              </div>

              {self.lives.length > 0 && (
                <div className="border-t border-card-border pt-5 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">
                  <label
                    htmlFor="legacy-display-choice"
                    className="mb-2 block text-body-xs font-medium uppercase tracking-wider text-muted"
                  >
                    Hall of Fame display name
                  </label>
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <select
                      id="legacy-display-choice"
                      value={pendingChoice}
                      onChange={(e) => setPendingChoice(e.target.value)}
                      className="min-h-10 w-full rounded-lg border border-card-border bg-background px-3 py-2 text-sm text-foreground sm:w-auto"
                    >
                      <option value="">Best life (default)</option>
                      {self.lives.map((life) => (
                        <option key={life.characterId} value={life.characterId}>
                          {life.name} — {life.iterationLabel}
                          {life.isActive ? " (current)" : ""}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={saveDisplayName}
                      disabled={saving}
                      className="min-h-10 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary/90 disabled:opacity-50"
                    >
                      {saving ? "Saving…" : "Save"}
                    </button>
                  </div>
                  {saveError && <p className="mt-2 text-xs text-error">{saveError}</p>}
                </div>
              )}
            </div>
          </section>
        )}

        {entries.length === 0 ? (
          <EmptyState
            title="No lives on record yet"
            description={
              scope === "current"
                ? "No one has scored in the current iteration yet."
                : "Once players start earning achievements and influence, the Hall of Fame will fill in."
            }
          />
        ) : (
          <section className={`space-y-3 ${loading ? "opacity-60" : ""}`}>
            <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="text-body-xs font-medium uppercase tracking-wider text-primary">
                  {isNetWorth ? "The vault" : "The record book"}
                </p>
                <h2 className="mt-1 text-xl font-bold text-foreground">
                  {isNetWorth ? "Richest ever" : "All-time rankings"}
                  {scope === "current" ? " — this iteration" : ""}
                </h2>
              </div>
              <p className="text-xs text-muted">
                Showing top {entries.length} of {totalCount} players
              </p>
            </div>
            <ResponsiveTable
              columns={columns}
              data={entries}
              keyExtractor={(row) => row.userId}
              emptyMessage="No lives on record yet."
            />
          </section>
        )}
      </main>

      <ScoreBreakdownModal
        row={breakdownRow}
        rankBy={rankBy}
        onClose={() => setBreakdownRow(null)}
      />
    </div>
  );
}
