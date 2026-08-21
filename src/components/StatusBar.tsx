"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import {
  formatCurrencyCompactChip,
  formatCurrencyFull,
  formatRealTimeCountdown,
  turnToLarpDate,
} from "@/lib/utils/formatters";
import { calendarTurn } from "@/lib/utils/gameDate";
import { CURRENCY_SYMBOLS, type CurrencyCode } from "@/lib/constants/currencies";
import { useCurrency } from "@/contexts/CurrencyContext";
import { useRefetchNav } from "@/contexts/AuthDataContext";
import { CHARACTER_STATS_UPDATED, CHARACTER_STATS_REFETCH } from "@/lib/characterStatsSync";
import {
  useCharacterStats,
  buildStatusPatch,
  type CorpHistoryPoint,
} from "@/contexts/CharacterStatsContext";
import { useGameTurnStatus } from "@/hooks/useGameEvents";
import { isLightweightLayoutPath } from "@/lib/constants/layoutPaths";
import { buildClientStatusUrl } from "@/lib/statusBar/clientStatusRequest";
import {
  ACTION_CAP,
  ACTION_HOARDING_PENALTY,
  ACTION_HOARDING_THRESHOLD,
} from "@/lib/actions/recommendationsConstants";
import { TooltipLink } from "./statusbar/TooltipLink";
import { Sparkline } from "./statusbar/Sparkline";
import { BreakdownRow } from "./statusbar/BreakdownRow";
import { CorpCashStatusChip } from "./statusbar/CorpCashStatusChip";
import { StatusChip } from "./statusbar/StatusChip";
import { OnlineStatusDot } from "./statusbar/OnlineStatusDot";
import {
  STATUS_BAR_CONTAINER_CLASS,
  statusBarRowClassName,
} from "./statusbar/statusBarLayoutClasses";
import { useStatusBarLayout, type StatusBarLayout } from "./statusbar/useStatusBarLayout";

export type { StatusBarLayout };

// Pages that should NOT show the status bar
const EXCLUDED_PATHS = ["/", "/login", "/register", "/banned"];

interface OnlineStatus {
  online: number;
}

export function StatusBar() {
  const pathname = usePathname();
  const isExcludedPath = EXCLUDED_PATHS.includes(pathname) || isLightweightLayoutPath(pathname);
  const { stats, patchStats } = useCharacterStats();
  const {
    displayCurrencyPreference,
    formatPrice: ctxFormatPrice,
    toInternalFrom,
    formatAmount,
    formatAmountChip,
    formatFull,
  } = useCurrency();
  // Only the refetch — StatusBar renders nothing from the nav payload; it is
  // the one component that already watches the turn counter.
  const refetchNav = useRefetchNav();
  const isInternalMode = displayCurrencyPreference === "internal";
  const homeCurrencyCode = (stats?.homeCurrency as CurrencyCode | undefined) ?? "USD";
  /** Format a home-currency face amount without re-converting it through display preference. */
  const compactFaceHome = (homeAmount: number) =>
    formatCurrencyCompactChip(homeAmount, CURRENCY_SYMBOLS[homeCurrencyCode] ?? "$");
  /**
   * Full (non-compact) face format for the campaign-income breakdown. Campaign
   * funds are stored/returned in LOCAL currency at the frozen INITIAL_RATES scale
   * — never convert them through display preference (formatFull) or they would
   * double-convert against live forex.
   */
  const fullFaceHome = (homeAmount: number) =>
    formatCurrencyFull(homeAmount, CURRENCY_SYMBOLS[homeCurrencyCode] ?? "$");
  /**
   * Format internal-unit amounts for the breakdown tooltips.
   * `nativeCurrencyCode` lets callers override the "local"-mode source currency
   * (e.g. pass corp.liquidCurrencyCode when the value originates from a corp
   * stored in a non-home currency post-v0.2.6).
   */
  const compactInternal = (internalAmount: number, nativeCurrencyCode?: CurrencyCode) =>
    isInternalMode
      ? formatCurrencyCompactChip(internalAmount, "₳")
      : formatAmountChip(internalAmount, nativeCurrencyCode ?? homeCurrencyCode);
  const [onlineStatus, setOnlineStatus] = useState<OnlineStatus | null>(null);
  const gameState = useGameTurnStatus(!isExcludedPath);
  const isProcessing = gameState?.isProcessing ?? false;
  const { layout, layoutSynced } = useStatusBarLayout();
  const previousLayoutRef = useRef<StatusBarLayout | null>(null);

  // Track personal cash changes triggered by actions (e.g. fundraise)
  const prevCashRef = useRef<number | null>(null);
  const [cashDelta, setCashDelta] = useState<number | null>(null);

  // Seed prevCashRef on first stats load (no delta shown for initial value)
  useEffect(() => {
    if (stats?.cashOnHand != null && prevCashRef.current === null) {
      prevCashRef.current = stats.cashOnHand;
    }
  }, [stats?.cashOnHand]);

  const fetchOnlineStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/players/online", { signal: AbortSignal.timeout(10_000) });
      if (res.ok) {
        const data = await res.json();
        setOnlineStatus(data);
      }
    } catch (error) {
      console.error("Failed to fetch online status:", error);
    }
  }, []);

  useEffect(() => {
    if (isExcludedPath) return;
    const pollOnlineStatus = () => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") {
        return;
      }
      void fetchOnlineStatus();
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void fetchOnlineStatus();
      }
    };

    pollOnlineStatus();
    const intervalId = setInterval(pollOnlineStatus, 300_000);
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", handleVisibilityChange);
    }

    return () => {
      clearInterval(intervalId);
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", handleVisibilityChange);
      }
    };
  }, [isExcludedPath, fetchOnlineStatus]);

  // Listen for character stats updates (e.g. after actions like fundraise)
  useEffect(() => {
    const handler = (e: Event) => {
      const ev = e as CustomEvent<{
        actions: number;
        funds: number;
        campaignFundsStored?: number;
        cashOnHand?: number;
        personalHomeLiquid?: number;
      }>;
      if (ev.detail) {
        const nextPersonalHomeLiquid = ev.detail.personalHomeLiquid ?? ev.detail.cashOnHand;
        if (nextPersonalHomeLiquid != null && prevCashRef.current != null) {
          const delta = nextPersonalHomeLiquid - prevCashRef.current;
          if (delta !== 0) setCashDelta(delta);
          prevCashRef.current = nextPersonalHomeLiquid;
        }
        patchStats({
          actions: ev.detail.actions,
          funds: ev.detail.funds,
          ...(typeof ev.detail.campaignFundsStored === "number"
            ? { campaignFundsStored: ev.detail.campaignFundsStored }
            : {}),
          ...(ev.detail.cashOnHand != null ? { cashOnHand: ev.detail.cashOnHand } : {}),
          ...(nextPersonalHomeLiquid != null ? { personalHomeLiquid: nextPersonalHomeLiquid } : {}),
        });
      }
    };
    window.addEventListener(CHARACTER_STATS_UPDATED, handler);
    return () => window.removeEventListener(CHARACTER_STATS_UPDATED, handler);
  }, [patchStats]);

  // Single consolidated refetch of /api/client-status, shared by every freshness
  // trigger below (on-demand trade events, turn change, tab focus, polling, and
  // layout change). Uses no-cache (not no-store) so the browser ALWAYS
  // revalidates against the origin — never served a stale body — while the
  // endpoint's private ETag lets an unchanged poll return a body-less 304,
  // cutting egress on this large, every-session payload.
  const refetchStats = useCallback(async () => {
    try {
      const res = await fetch(buildClientStatusUrl(layout), {
        signal: AbortSignal.timeout(10_000),
        cache: "no-cache",
      });
      if (!res.ok) return;
      const data = await res.json();
      if (data.status === "no-character") return;
      if (typeof data.cashOnHand === "number" && prevCashRef.current != null) {
        const delta = data.cashOnHand - prevCashRef.current;
        if (delta !== 0) setCashDelta(delta);
        prevCashRef.current = data.cashOnHand;
      }
      patchStats(buildStatusPatch(data));
    } catch {
      /* network/timeout — chips stay as-is until the next trigger */
    }
  }, [layout, patchStats]);

  // Trade flows (bonds/shares/forex/savings/transfers) that mutate wallet state
  // but don't echo the new character dispatch CHARACTER_STATS_REFETCH.
  useEffect(() => {
    const handler = () => void refetchStats();
    window.addEventListener(CHARACTER_STATS_REFETCH, handler);
    return () => window.removeEventListener(CHARACTER_STATS_REFETCH, handler);
  }, [refetchStats]);

  // Refresh when the status-bar layout changes — different chips need fields the
  // previous payload may have omitted.
  useEffect(() => {
    if (isExcludedPath || !layoutSynced) return;
    const previousLayout = previousLayoutRef.current;
    previousLayoutRef.current = layout;
    if (previousLayout === null || previousLayout === layout) return;
    void refetchStats();
  }, [isExcludedPath, layout, layoutSynced, refetchStats]);

  // Refresh when a new turn processes — the turn engine grants action points and
  // campaign-fund income server-side, so without this the bar lags a full turn
  // (the primary cause of the Actions/Campaign-Funds mismatch).
  //
  // The NAV bootstrap is refreshed on the same trigger. `/api/client-nav` is
  // fetched once when its provider mounts and never again, so in a
  // client-routed session every world-state flag it carries is frozen for the
  // whole visit — a settlement crisis that closed on the tick left "The German
  // Question" in the World menu until a hard reload. Same latent staleness for
  // `conflictsEnabled` and `unionsEnabled`; those just change far more rarely.
  const prevTurnRef = useRef<number | null>(null);
  useEffect(() => {
    const turn = gameState?.currentTurn;
    if (turn == null) return;
    if (prevTurnRef.current === null) {
      prevTurnRef.current = turn;
      return;
    }
    if (turn !== prevTurnRef.current) {
      prevTurnRef.current = turn;
      void refetchStats();
      refetchNav();
    }
  }, [gameState?.currentTurn, refetchStats, refetchNav]);

  // Refresh when the player returns to the tab, plus a light visible-only poll,
  // so the bar self-heals even if a specific trigger is missed.
  useEffect(() => {
    if (isExcludedPath) return;
    const onVisibility = () => {
      if (document.visibilityState === "visible") void refetchStats();
    };
    const pollIfVisible = () => {
      if (document.visibilityState === "visible") void refetchStats();
    };
    document.addEventListener("visibilitychange", onVisibility);
    const intervalId = setInterval(pollIfVisible, 60_000);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      clearInterval(intervalId);
    };
  }, [isExcludedPath, refetchStats]);

  const getTimeUntilNextTurn = () => {
    if (!gameState?.nextScheduledTurn) return null;
    // The next-turn countdown targets the wall-clock cron schedule, not a
    // game-clock deadline — so we use formatRealTimeCountdown rather than
    // useGameClock. See docs/plans/archive/2026-05/2026-05-20-clock-mismatch-design.md.
    const text = formatRealTimeCountdown(gameState.nextScheduledTurn, gameState.pausedAt ?? null);
    if (text === "Ended") return "Processing...";
    return text;
  };

  // Don't render on excluded paths
  if (isExcludedPath) {
    return null;
  }

  // ── Computed tooltip data ───────────────────────────────────

  // Actions breakdown — server-computed from gameConfig so the tooltip matches
  // exactly what actionRefresh.ts grants each turn. Falls back to the same
  // floor (4 base, 0 office/chair/party) the turn processor uses when a value
  // is missing from the API payload.
  const baseGain = stats?.baseActionsPerTurn ?? 4;
  const officeBonus = stats?.officeActionBonus ?? 0;
  const chairBonus = stats?.isCentralBankChair ? (stats.chairActionBonus ?? 0) : 0;
  const partyBonus = stats?.bonusActionsFromParty ?? 0;
  // Energy-scaled action cap / hoard threshold from the payload; fall back to
  // the baseline constants before the first stats load.
  const actionCap = stats?.actionCap ?? ACTION_CAP;
  const hoardThreshold = stats?.hoardThreshold ?? ACTION_HOARDING_THRESHOLD;
  const isHoarding = (stats?.actions ?? 0) > hoardThreshold;
  const totalGain = Math.max(
    0,
    baseGain + officeBonus + chairBonus + partyBonus - (isHoarding ? ACTION_HOARDING_PENALTY : 0)
  );

  const influence = stats?.politicalInfluence ?? 0;

  // Elections compact data
  const elStats = stats?.electionStats ?? null;

  // CEO salary per hour (stored as daily rate — profile page shows ceoSalary/24).
  // Post-v0.2.6: ceoSalary is in the corp's liquidCurrencyCode; normalize to ₳
  // so compactInternal (which treats input as ₳) renders correctly, and pass
  // the corp currency so wallet-pref display honors it.
  const ceoCorpCurrency =
    (stats?.corp?.liquidCurrencyCode as CurrencyCode | undefined) ?? undefined;
  const ceoSalaryPerHourLocal = (stats?.corp?.ceoSalary ?? 0) / 24;
  const ceoSalaryPerHourAnchor = ceoCorpCurrency
    ? toInternalFrom(ceoSalaryPerHourLocal, ceoCorpCurrency)
    : ceoSalaryPerHourLocal;

  // Corp history arrays for sparklines
  const corpHistory: CorpHistoryPoint[] = stats?.corp?.history ?? [];
  const sharePriceHistory = corpHistory.map((h) => h.sharePrice);
  const msHistory = corpHistory.map((h) => h.marketingStrength);
  const cashHistory = corpHistory.map((h) => h.liquidCapital);

  const isFullLayout = layout === "full";
  const isMinimalLayout = layout === "minimal";
  const showElectionChips = layout === "elections" || isFullLayout;
  const showCorpStrip = layout === "corp" || isFullLayout;
  const showStandardCorpCashOnly = layout === "standard" && !!stats?.corp;
  // Corp/elections/minimal use compact inline count; full gets its own placement in the right chip area
  const compactOnlineCount = layout === "corp" || layout === "elections" || isMinimalLayout;

  return (
    <div
      data-statusbar
      className={`${STATUS_BAR_CONTAINER_CLASS} ${stats ? "opacity-100" : "pointer-events-none opacity-0"}`}
      role="complementary"
      aria-label="Character stats and turn timer"
    >
      {/* Subtle top glow line */}
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/25 to-transparent" />
      <div
        className={`relative mx-auto flex max-w-7xl items-center px-3 py-2 sm:px-6 ${statusBarRowClassName(layout)}`}
      >
        {/* Left side - Character name and Turn info */}
        <div
          className={`flex min-w-0 items-center overflow-hidden ${isMinimalLayout ? "gap-x-0" : isFullLayout ? "shrink-0 flex-wrap gap-x-3 gap-y-1 sm:flex-nowrap sm:gap-x-4" : "flex-1 flex-wrap gap-x-3 gap-y-1 sm:flex-nowrap sm:gap-x-4"}`}
        >
          <Link
            href="/profile"
            className="truncate max-w-[140px] sm:max-w-none text-sm font-medium text-muted hover:text-foreground transition-colors"
          >
            {stats?.name ?? " "}
          </Link>

          {/* Pipe separator — minimal only */}
          {isMinimalLayout && gameState && (
            <span className="mx-3 hidden h-4 w-px shrink-0 bg-card-border/60 sm:block sm:mx-4" />
          )}

          {/* Turn Timer & LARP Date */}
          {gameState && (
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted sm:flex-nowrap sm:gap-x-4 sm:text-sm">
              <span className="shrink-0 tabular-nums text-muted" title="Current turn">
                Turn {gameState.currentTurn}
              </span>
              <span
                className="shrink-0 text-muted"
                title={
                  gameState.preIterationActive
                    ? "In-game date — frozen at the era start until the founding elections finish"
                    : "In-game date"
                }
              >
                {gameState.preIterationActive && (
                  <span className="mr-1.5 rounded bg-secondary/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-secondary">
                    Founding
                  </span>
                )}
                {turnToLarpDate(
                  calendarTurn(gameState.currentTurn, {
                    preIterationActive: gameState.preIterationActive,
                    preIterationTurns: gameState.preIterationTurns,
                  }),
                  gameState.startingYear
                )}
              </span>
              <div className="flex min-w-0 shrink-0 items-center gap-1.5 sm:gap-2">
                {isProcessing ? (
                  <span className="inline-flex items-center gap-1 rounded-md bg-secondary/10 px-1.5 py-0.5 text-[11px] font-bold text-secondary sm:gap-1.5 sm:px-2 sm:py-1 sm:text-xs">
                    <svg
                      className="h-2.5 w-2.5 animate-spin sm:h-3 sm:w-3"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                      />
                    </svg>
                    <span className="hidden sm:inline">Turn Processing</span>
                    <span className="sm:hidden">Processing</span>
                  </span>
                ) : (
                  <>
                    <svg
                      className={`h-3.5 w-3.5 shrink-0 ${gameState.isActive ? "text-primary" : "text-yellow-500"}`}
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                      />
                    </svg>
                    {gameState.isActive && gameState.nextScheduledTurn ? (
                      <span className="shrink-0 tabular-nums">{getTimeUntilNextTurn()}</span>
                    ) : (
                      <span className="shrink-0 text-yellow-500">Paused</span>
                    )}
                  </>
                )}
              </div>
            </div>
          )}

          {/* Corp/elections/minimal: compact online count inline */}
          {compactOnlineCount && onlineStatus && (
            <>
              {/* Pipe separator before online count — minimal only */}
              {isMinimalLayout && (
                <span className="mx-3 hidden h-4 w-px shrink-0 bg-card-border/60 sm:block sm:mx-4" />
              )}
              <div className="hidden sm:flex items-center gap-2 text-sm text-muted shrink-0">
                <OnlineStatusDot />
                {isMinimalLayout ? (
                  <span>
                    <span className="font-medium text-foreground tabular-nums">
                      {onlineStatus.online}
                    </span>{" "}
                    Player{onlineStatus.online !== 1 ? "s" : ""} Online
                  </span>
                ) : (
                  <span className="font-medium text-foreground tabular-nums">
                    {onlineStatus.online}
                  </span>
                )}
              </div>
            </>
          )}
        </div>

        {/* Standard only: centered "N Player(s) Online" — full uses right-chip-area instead */}
        {!compactOnlineCount && !isFullLayout && onlineStatus && (
          <div className="pointer-events-none hidden sm:flex absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 items-center gap-2 text-sm text-muted">
            <OnlineStatusDot />
            <span>
              <span className="font-medium text-foreground">{onlineStatus.online}</span> Player
              {onlineStatus.online !== 1 ? "s" : ""} Online
            </span>
          </div>
        )}

        {/* Right side - Colored Chips (hidden in minimal layout) */}
        <div
          className={`flex shrink-0 items-center gap-1 sm:gap-1.5 ${isMinimalLayout ? "hidden" : ""}`}
        >
          {/* Profile label — desktop only; shrink-0 so mono themes cannot crush it into the online count */}
          <span className="hidden sm:inline shrink-0 text-[10px] font-semibold uppercase tracking-wide text-muted/50 mr-0.5">
            Profile
          </span>

          {/* Actions chip */}
          <StatusChip
            colorClasses="bg-primary/10 text-primary hover:bg-primary/20"
            icon={
              <svg
                className="h-2.5 w-2.5 sm:h-3 sm:w-3"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2.5}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            }
            value={stats?.actions ?? 0}
            ariaLabel={`${stats?.actions ?? 0} actions`}
          >
            <p className="font-semibold text-foreground mb-2">Actions</p>
            <div className="space-y-1 mb-2">
              <BreakdownRow label="Base" value={`+${baseGain}/turn`} />
              {officeBonus > 0 && (
                <BreakdownRow
                  label={`${stats?.currentOfficeType ?? "Office"} bonus`}
                  value={`+${officeBonus}/turn`}
                  valueClass="text-primary"
                />
              )}
              {chairBonus > 0 && (
                <BreakdownRow
                  label="Central bank chair"
                  value={`+${chairBonus}/turn`}
                  valueClass="text-primary"
                />
              )}
              {partyBonus > 0 && (
                <BreakdownRow
                  label="Party influence"
                  value={`+${partyBonus}/turn`}
                  valueClass="text-primary"
                />
              )}
              {isHoarding && (
                <BreakdownRow
                  label={`Hoard penalty (>${hoardThreshold})`}
                  value={`−${ACTION_HOARDING_PENALTY}/turn`}
                  valueClass="text-red-400"
                />
              )}
              <BreakdownRow
                label="Net gain"
                value={`+${totalGain}/turn`}
                valueClass="font-semibold text-foreground"
              />
              <BreakdownRow label="Cap" value={String(actionCap)} />
            </div>
            <div className="flex justify-between text-[11px] border-t border-card-border/60 pt-1.5">
              <span className="text-muted">Remaining</span>
              <span className="font-bold text-primary tabular-nums">{stats?.actions ?? 0}</span>
            </div>
            <TooltipLink href="/actions">Go to Actions</TooltipLink>
          </StatusChip>

          {/* Campaign Funds chip */}
          <StatusChip
            colorClasses="bg-green-500/10 text-green-500 hover:bg-green-500/20"
            width={250}
            icon={
              <svg
                className="hidden sm:block h-3 w-3"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8V7m0 10v1"
                />
              </svg>
            }
            value={compactFaceHome(stats?.campaignFundsStored ?? 0)}
            ariaLabel={`Campaign funds: ${compactFaceHome(stats?.campaignFundsStored ?? 0)}`}
          >
            <div className="flex items-center justify-between mb-2">
              <p className="font-semibold text-foreground">Campaign Funds</p>
              <span className="text-green-500 font-bold tabular-nums">
                {compactFaceHome(stats?.campaignFundsStored ?? 0)}
              </span>
            </div>
            {stats?.campaignIncomeBreakdown ? (
              <>
                <div className="space-y-1 mb-2">
                  <BreakdownRow
                    label={`Base Gen (${stats.campaignIncomeBreakdown.populationTier})`}
                    value={`+${fullFaceHome(stats.campaignIncomeBreakdown.baseGen)}`}
                    valueClass="text-green-500/90"
                  />
                  {stats.campaignIncomeBreakdown.donorBonus > 0 && (
                    <BreakdownRow
                      label="Donor Network Bonus"
                      value={`+${fullFaceHome(stats.campaignIncomeBreakdown.donorBonus)}`}
                      valueClass="text-green-500/90"
                    />
                  )}
                  {stats.campaignIncomeBreakdown.officeBonus > 0 && (
                    <BreakdownRow
                      label="Office Salary"
                      value={`+${fullFaceHome(stats.campaignIncomeBreakdown.officeBonus)}`}
                      valueClass="text-green-500/90"
                    />
                  )}
                  {(stats.campaignIncomeBreakdown.unionContribution ?? 0) > 0 && (
                    <BreakdownRow
                      label="Union Contribution"
                      value={`+${fullFaceHome(stats.campaignIncomeBreakdown.unionContribution)}`}
                      valueClass="text-green-500/90"
                    />
                  )}
                  {stats.campaignIncomeBreakdown.totalTax > 0 && (
                    <BreakdownRow
                      label="Party Taxes"
                      value={`−${fullFaceHome(stats.campaignIncomeBreakdown.totalTax)}`}
                      valueClass="text-red-400"
                    />
                  )}
                </div>
                <div className="flex justify-between text-[11px] border-t border-card-border/60 pt-1.5">
                  <span className="text-muted font-semibold">Net / hr</span>
                  <span
                    className={`font-bold tabular-nums ${
                      stats.campaignIncomeBreakdown.netPerTurn >= 0
                        ? "text-green-500"
                        : "text-red-400"
                    }`}
                  >
                    {stats.campaignIncomeBreakdown.netPerTurn >= 0 ? "+" : ""}
                    {fullFaceHome(stats.campaignIncomeBreakdown.netPerTurn)}
                  </span>
                </div>
              </>
            ) : (
              <p className="text-[11px] text-muted mb-2">
                Hourly CF income unavailable — open Profile for details.
              </p>
            )}
            <TooltipLink href="/profile">View Profile</TooltipLink>
          </StatusChip>

          {/* Personal Cash chip */}
          <StatusChip
            colorClasses="bg-amber-500/10 text-amber-500 hover:bg-amber-500/20"
            icon={
              <svg
                className="hidden sm:block h-3 w-3"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z"
                />
              </svg>
            }
            value={compactFaceHome(stats?.personalHomeLiquid ?? 0)}
            ariaLabel={`Personal cash: ${compactFaceHome(stats?.personalHomeLiquid ?? 0)}`}
          >
            <div className="flex items-center justify-between mb-2">
              <p className="font-semibold text-foreground">Personal Cash</p>
              <span className="text-amber-500 font-bold tabular-nums">
                {compactFaceHome(stats?.personalHomeLiquid ?? 0)}
              </span>
            </div>
            <div className="space-y-1 mb-1.5">
              {cashDelta !== null && cashDelta !== 0 && (
                <BreakdownRow
                  label="Since last action"
                  value={`${cashDelta > 0 ? "+" : "−"}${compactInternal(Math.abs(cashDelta))}`}
                  valueClass={cashDelta > 0 ? "text-green-500" : "text-red-400"}
                />
              )}
              {ceoSalaryPerHourAnchor > 0 && (
                <BreakdownRow
                  label="CEO salary"
                  value={`+${compactInternal(ceoSalaryPerHourAnchor, ceoCorpCurrency)}/hr`}
                  valueClass="text-amber-400"
                />
              )}
              {(stats?.dividendIncome ?? 0) > 0 && (
                <BreakdownRow
                  label="Dividends"
                  value={`+${compactInternal(stats!.dividendIncome)}/turn`}
                  valueClass="text-amber-400"
                />
              )}
              {(stats?.bondIncome ?? 0) > 0 && (
                <BreakdownRow
                  label="Bond coupons"
                  value={`+${compactInternal(stats!.bondIncome)}/turn`}
                  valueClass="text-amber-400"
                />
              )}
            </div>
            <TooltipLink href="/portfolio">View Portfolio</TooltipLink>
          </StatusChip>

          {showStandardCorpCashOnly && stats.corp && (
            <CorpCashStatusChip
              corp={stats.corp}
              cashHistory={cashHistory}
              toInternalFrom={toInternalFrom}
              formatAmount={formatAmount}
              formatFull={formatFull}
            />
          )}

          {/* Elections Compact — PI + FAV always; vote% and seat projection if in election */}
          {showElectionChips && (
            <>
              <div
                className={`hidden sm:block w-px h-4 bg-card-border/60 ${isFullLayout ? "mx-2 sm:mx-3" : "mx-0.5"}`}
              />
              <span className="hidden sm:inline text-[10px] font-semibold uppercase tracking-wide text-muted/50 mr-0.5">
                Elections
              </span>

              {/* Political Influence chip */}
              <StatusChip
                colorClasses="bg-indigo-500/10 text-indigo-400 hover:bg-indigo-500/20"
                width={230}
                icon={
                  <svg
                    className="hidden sm:block h-3 w-3"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
                    />
                  </svg>
                }
                value={
                  <>
                    <span className="hidden sm:inline text-[10px] font-semibold text-indigo-400/60">
                      PI
                    </span>
                    {Math.round(influence)}%
                  </>
                }
                ariaLabel={`Political influence: ${Math.round(influence)}%`}
              >
                <p className="font-semibold text-foreground mb-2">Political Influence</p>
                <p className="text-[11px] text-muted leading-relaxed">
                  A proxy for name recognition — how well-known you are as a political figure. High
                  influence is essential to winning elections. Maintaining this stat should be your
                  number one priority.
                </p>
                <TooltipLink href="/profile">View Profile</TooltipLink>
              </StatusChip>

              {/* Favorability chip — color tier reflects current value */}
              {(() => {
                const fav = stats?.favorability ?? 0;
                const favClasses =
                  fav >= 60
                    ? "bg-green-500/10 text-green-400 hover:bg-green-500/20"
                    : fav >= 40
                      ? "bg-yellow-500/10 text-yellow-400 hover:bg-yellow-500/20"
                      : "bg-red-500/10 text-red-400 hover:bg-red-500/20";
                return (
                  <StatusChip
                    colorClasses={favClasses}
                    width={230}
                    icon={
                      <svg
                        className="hidden sm:block h-3 w-3"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={2}
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"
                        />
                      </svg>
                    }
                    value={
                      <>
                        <span className="hidden sm:inline text-[10px] font-semibold opacity-60">
                          FAV
                        </span>
                        {Math.round(fav)}%
                      </>
                    }
                    ariaLabel={`Favorability: ${fav}%`}
                  >
                    <p className="font-semibold text-foreground mb-2">Favorability</p>
                    <p className="text-[11px] text-muted leading-relaxed">
                      How popular your politician is with the general public. High favorability
                      improves vote share, demographic appeal, and media coverage. Opponents can
                      attack this stat directly — watch it carefully.
                    </p>
                    <TooltipLink href="/profile">View Profile</TooltipLink>
                  </StatusChip>
                );
              })()}

              {/* Vote % chip — only when in an active election with votes cast */}
              {elStats &&
                elStats.myVotePct > 0 &&
                (() => {
                  const isLeading = elStats.marginPct === null || elStats.marginPct >= 0;
                  const marginStr =
                    elStats.marginPct !== null
                      ? elStats.marginPct >= 0
                        ? `+${elStats.marginPct.toFixed(1)}%`
                        : `${elStats.marginPct.toFixed(1)}%`
                      : null;
                  const voteHistory = elStats.history.map((h) => h.pct);
                  return (
                    <StatusChip
                      colorClasses={
                        isLeading
                          ? "bg-green-500/10 text-green-400 hover:bg-green-500/20"
                          : "bg-orange-500/10 text-orange-400 hover:bg-orange-500/20"
                      }
                      icon={
                        <svg
                          className="hidden sm:block h-3 w-3"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                          strokeWidth={2}
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
                          />
                        </svg>
                      }
                      value={
                        <>
                          {elStats.myVotePct.toFixed(1)}%
                          {marginStr && (
                            <span
                              className={`text-[10px] font-semibold ${isLeading ? "text-green-300" : "text-orange-300"}`}
                            >
                              {marginStr}
                            </span>
                          )}
                        </>
                      }
                      ariaLabel={`Vote share: ${elStats.myVotePct.toFixed(1)}%`}
                    >
                      <p className="font-semibold text-foreground mb-2">Vote Share</p>
                      <div className="space-y-1 mb-2">
                        <BreakdownRow
                          label="Your share"
                          value={`${elStats.myVotePct.toFixed(1)}%`}
                          valueClass={isLeading ? "text-green-400" : "text-orange-400"}
                        />
                        {marginStr && (
                          <BreakdownRow
                            label={isLeading ? "Margin ahead" : "Behind leader"}
                            value={marginStr}
                            valueClass={isLeading ? "text-green-400" : "text-red-400"}
                          />
                        )}
                      </div>
                      {voteHistory.length >= 2 && (
                        <div className="mt-1 mb-2">
                          <p className="text-[10px] text-muted mb-1">
                            Vote % (last {voteHistory.length} turns)
                          </p>
                          <Sparkline
                            data={voteHistory}
                            color={isLeading ? "#4ade80" : "#fb923c"}
                            width={188}
                            height={30}
                          />
                        </div>
                      )}
                      <TooltipLink href={`/elections/${elStats.electionId}`}>
                        View Election
                      </TooltipLink>
                    </StatusChip>
                  );
                })()}

              {/* Seat projection chip — multi-seat elections only */}
              {elStats &&
                elStats.isMultiSeat &&
                elStats.seatsProjected !== null &&
                (() => {
                  const seatHistory = elStats.history
                    .map((h) => h.seats ?? 0)
                    .filter((_, i, arr) => arr.some((v) => v > 0));
                  return (
                    <StatusChip
                      colorClasses="bg-teal-500/10 text-teal-400 hover:bg-teal-500/20"
                      icon={
                        <svg
                          className="hidden sm:block h-3 w-3"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                          strokeWidth={2}
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"
                          />
                        </svg>
                      }
                      value={`${elStats.seatsProjected}/${elStats.totalSeats}`}
                      ariaLabel={`Projected seats: ${elStats.seatsProjected}/${elStats.totalSeats}`}
                    >
                      <p className="font-semibold text-foreground mb-2">Seat Projection</p>
                      <div className="space-y-1 mb-2">
                        <BreakdownRow
                          label="Projected seats"
                          value={`${elStats.seatsProjected}`}
                          valueClass="text-teal-400"
                        />
                        <BreakdownRow label="Total seats" value={`${elStats.totalSeats}`} />
                      </div>
                      {seatHistory.length >= 2 && (
                        <div className="mt-1 mb-2">
                          <p className="text-[10px] text-muted mb-1">
                            Seats (last {seatHistory.length} turns)
                          </p>
                          <Sparkline data={seatHistory} color="#2dd4bf" width={188} height={30} />
                        </div>
                      )}
                      <TooltipLink href={`/elections/${elStats.electionId}`}>
                        View Election
                      </TooltipLink>
                    </StatusChip>
                  );
                })()}
            </>
          )}

          {/* Corp Compact — stock ticker (desktop only) + corp cash + MS */}
          {showCorpStrip && stats?.corp && (
            <>
              <div
                className={`hidden sm:block w-px h-4 bg-card-border/60 ${isFullLayout ? "mx-2 sm:mx-3" : "mx-0.5"}`}
              />
              {/* Corp label — desktop only */}
              <span className="hidden sm:inline text-[10px] font-semibold uppercase tracking-wide text-muted/50 mr-0.5">
                Corp
              </span>

              {/* Stock price ticker — desktop only */}
              <StatusChip
                wrapperClassName="hidden sm:inline-flex"
                colorClasses={
                  (stats.corp.priceChange1h ?? 0) >= 0
                    ? "bg-teal-500/10 text-teal-400 hover:bg-teal-500/20"
                    : "bg-red-500/10 text-red-400 hover:bg-red-500/20"
                }
                icon={
                  <svg
                    className="h-3 w-3"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"
                    />
                  </svg>
                }
                value={
                  <>
                    <span className="text-muted/70 font-semibold">
                      {stats.corp.name.length > 10
                        ? stats.corp.name.slice(0, 10) + "…"
                        : stats.corp.name}
                    </span>
                    <span>
                      {ctxFormatPrice(
                        ceoCorpCurrency
                          ? toInternalFrom(stats.corp.sharePrice, ceoCorpCurrency)
                          : stats.corp.sharePrice,
                        ceoCorpCurrency
                      )}
                    </span>
                    <span
                      className={
                        (stats.corp.priceChange1h ?? 0) >= 0 ? "text-green-400" : "text-red-400"
                      }
                    >
                      {(stats.corp.priceChange1h ?? 0) >= 0 ? "+" : ""}
                      {(stats.corp.priceChange1h ?? 0).toFixed(1)}%
                    </span>
                  </>
                }
                ariaLabel={`${stats.corp.name} stock price`}
              >
                <p className="font-semibold text-foreground mb-2">{stats.corp.name}</p>
                <div className="space-y-1 text-[11px] mb-2">
                  <BreakdownRow
                    label="Share price"
                    value={ctxFormatPrice(
                      ceoCorpCurrency
                        ? toInternalFrom(stats.corp.sharePrice, ceoCorpCurrency)
                        : stats.corp.sharePrice,
                      ceoCorpCurrency
                    )}
                  />
                  <BreakdownRow
                    label="Change (1 turn)"
                    value={`${(stats.corp.priceChange1h ?? 0) >= 0 ? "+" : ""}${(stats.corp.priceChange1h ?? 0).toFixed(2)}%`}
                    valueClass={
                      (stats.corp.priceChange1h ?? 0) >= 0 ? "text-green-400" : "text-red-400"
                    }
                  />
                </div>
                {sharePriceHistory.length >= 2 && (
                  <div className="mt-1 mb-2">
                    <p className="text-[10px] text-muted mb-1">
                      Share price (last {sharePriceHistory.length} turns)
                    </p>
                    <Sparkline
                      data={sharePriceHistory}
                      color={(stats.corp.priceChange1h ?? 0) >= 0 ? "#2dd4bf" : "#f87171"}
                      width={188}
                      height={30}
                    />
                  </div>
                )}
                <TooltipLink href={`/corporation/${stats.corp.sequentialId}`}>
                  View Corporation
                </TooltipLink>
              </StatusChip>

              <CorpCashStatusChip
                corp={stats.corp}
                cashHistory={cashHistory}
                toInternalFrom={toInternalFrom}
                formatAmount={formatAmount}
                formatFull={formatFull}
              />

              {/* Marketing strength — mobile + desktop */}
              <StatusChip
                colorClasses="bg-violet-500/10 text-violet-400 hover:bg-violet-500/20"
                width={240}
                icon={
                  <svg
                    className="hidden sm:block h-3 w-3"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z"
                    />
                  </svg>
                }
                value={
                  <>
                    <span className="hidden sm:inline text-violet-400/60 font-semibold text-[10px]">
                      MS
                    </span>
                    {stats.corp.marketingStrength >= 1_000_000
                      ? `${(stats.corp.marketingStrength / 1_000_000).toFixed(2)}M`
                      : stats.corp.marketingStrength >= 1_000
                        ? `${(stats.corp.marketingStrength / 1_000).toFixed(2)}K`
                        : stats.corp.marketingStrength.toFixed(2)}
                  </>
                }
                ariaLabel={`${stats.corp.name} marketing strength`}
              >
                <p className="font-semibold text-foreground mb-2">{stats.corp.name}</p>
                <BreakdownRow
                  label="Marketing strength"
                  value={stats.corp.marketingStrength.toLocaleString("en-US")}
                  valueClass="text-violet-400"
                />
                {msHistory.length >= 2 && (
                  <div className="mt-2 mb-1">
                    <p className="text-[10px] text-muted mb-1">
                      MS (last {msHistory.length} turns)
                    </p>
                    <Sparkline data={msHistory} color="#a78bfa" width={208} height={30} />
                  </div>
                )}
                <p className="text-[11px] text-muted leading-relaxed mt-1">
                  Boosts the share of unowned market you capture on each sector split (+MS/100 on
                  top of the 2% baseline). Grows from daily marketing spend.
                </p>
                <TooltipLink href={`/corporation/${stats.corp.sequentialId}`}>
                  View Corporation
                </TooltipLink>
              </StatusChip>
            </>
          )}

          {/* Online count end-cap — full layout only; sits at the far right of the bar */}
          {isFullLayout && onlineStatus && (
            <>
              <div className="hidden sm:block w-px h-4 bg-card-border/60 mx-3 sm:mx-4" />
              <div className="hidden sm:flex items-center gap-2 text-sm text-muted shrink-0">
                <OnlineStatusDot />
                <span>
                  <span className="font-medium text-foreground tabular-nums">
                    {onlineStatus.online}
                  </span>{" "}
                  Online
                </span>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
