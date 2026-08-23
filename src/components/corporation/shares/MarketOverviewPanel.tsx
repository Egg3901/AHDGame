"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Avatar } from "@/components/Avatar";
import { useLocalCurrency } from "@/hooks/useLocalCurrency";
import { getExchangeForCountry } from "@/lib/constants/exchangeRegistry";
import {
  LiveBadge,
  Sparkline,
  Change,
  Meter,
} from "@/components/corporation/market/MarketPrimitives";
import { useSharePriceHistory } from "@/components/corporation/market/useSharePriceHistory";
import type { CorporationDetail, VoteTally } from "../CorporationPageTypes";
import { shareholderVotingPower, totalVotingPower } from "@/lib/corporations/superShares";
import {
  insiderConcentrationMultiplier,
  INSIDER_CONCENTRATION_THRESHOLD,
} from "@/lib/corporations/sharePriceFormula";
import { fetchJson } from "@/lib/observability/fetchJson";
import { brandShades, resolveCorpColor } from "@/lib/corporations/brandColor";

// ─── Constants ────────────────────────────────────────────────────────────────

// Slices are shades of the corporation's own brand colour, not a fixed rainbow.
// A cap table is one company's ownership, so the chart should read as that
// company; the twelve unrelated hues it used before said nothing about whose
// shares they were. See brandShades() for how the shades stay separable.
// Public float is deliberately OUTSIDE the ramp: those shares belong to no
// named holder, and a neutral grey says so at any brand hue.
const PUBLIC_FLOAT_COLOR = "hsl(215, 10%, 56%)";
/** Holders named individually in the pie; the rest collapse into one slice. */
const MAX_NAMED_SLICES = 10;
const PAGE_SIZE = 8;
const PIE_SIZE = 160;
const PIE_CX = PIE_SIZE / 2;
const PIE_CY = PIE_SIZE / 2;
const PIE_R = 64;

// ─── Pie slice builder ────────────────────────────────────────────────────────

interface PieSlice {
  label: string;
  shares: number;
  color: string;
  pct: number;
}

/**
 * Ranked holders to pie slices, tinted off the corp's own brand colour, with
 * everything past the top few collapsed into one slice.
 *
 * The tail has to collapse. Real cap tables here run to hundreds of holders, and
 * a pie with 250 wedges is 250 invisible slivers under a legend nobody can read.
 * No palette rescues that, so the chart names the holders who actually move the
 * company and totals the rest into one slice.
 */
function shadedSlices(
  corporation: CorporationDetail,
  ranked: Array<{ label: string; shares: number }>,
  total: number
): PieSlice[] {
  const head = ranked.slice(0, MAX_NAMED_SLICES);
  const tail = ranked.slice(MAX_NAMED_SLICES);
  const shades = brandShades(
    resolveCorpColor(corporation.brandColor, corporation._id),
    head.length + (tail.length > 0 ? 1 : 0)
  );

  const slices: PieSlice[] = head.map((holder, i) => ({
    label: holder.label,
    shares: holder.shares,
    color: shades[i],
    pct: total > 0 ? (holder.shares / total) * 100 : 0,
  }));

  if (tail.length > 0) {
    const tailShares = tail.reduce((sum, holder) => sum + holder.shares, 0);
    slices.push({
      label: `${tail.length} smaller holders`,
      shares: tailShares,
      color: shades[head.length],
      pct: total > 0 ? (tailShares / total) * 100 : 0,
    });
  }

  return slices;
}

function rankedShareholders(corporation: CorporationDetail) {
  return corporation.shareholders.slice().sort((a, b) => b.shares - a.shares);
}

function buildSlices(corporation: CorporationDetail): PieSlice[] {
  const { totalShares, publicFloat } = corporation;
  if (totalShares <= 0) return [];

  const slices = shadedSlices(
    corporation,
    rankedShareholders(corporation).map((sh) => ({ label: sh.name, shares: sh.shares })),
    totalShares
  );

  if ((publicFloat ?? 0) > 0) {
    slices.push({
      label: "Public Float",
      shares: publicFloat,
      color: PUBLIC_FLOAT_COLOR,
      pct: (publicFloat / totalShares) * 100,
    });
  }

  return slices;
}

function buildVotingSlices(corporation: CorporationDetail): PieSlice[] | null {
  if (!corporation.superShareMultiplier || corporation.superShareMultiplier < 2) return null;
  const tvp = totalVotingPower(corporation as Parameters<typeof totalVotingPower>[0]);
  if (tvp <= 0) return [];

  // Ranked by SHARES, same as the ownership pie, so a holder keeps the same
  // shade in both charts and the two can be read against each other.
  const slices = shadedSlices(
    corporation,
    rankedShareholders(corporation).map((sh) => ({
      label: sh.name,
      shares: shareholderVotingPower(
        corporation as Parameters<typeof shareholderVotingPower>[0],
        sh as Parameters<typeof shareholderVotingPower>[1]
      ),
    })),
    tvp
  );

  // Public float votes 1 per share
  if ((corporation.publicFloat ?? 0) > 0) {
    slices.push({
      label: "Public Float",
      shares: corporation.publicFloat,
      color: PUBLIC_FLOAT_COLOR,
      pct: (corporation.publicFloat / tvp) * 100,
    });
  }

  return slices;
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface MarketOverviewPanelProps {
  corporation: CorporationDetail;
  myCharacterId: string | null;
  corpId: string;
  onTrade?: () => void;
  onIssue?: () => void;
  onRefresh: () => void;
  setActionError: (v: string) => void;
  setActionSuccess: (v: string) => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function MarketOverviewPanel({
  corporation,
  myCharacterId,
  corpId,
  onTrade,
  onIssue,
  onRefresh,
  setActionError,
  setActionSuccess,
}: MarketOverviewPanelProps) {
  // sharePrice + marketCapitalization ship in corp LOCAL currency (Task 18A/18B);
  // useLocalCurrency handles LOCAL → ₳ → wallet-pref rendering in one step.
  const { fmtPrice, fmtAmount } = useLocalCurrency(corporation.liquidCurrencyCode);
  // Live price block — share-price sparkline + day change from recent history.
  const { series: priceSeries, dayChange } = useSharePriceHistory(corpId, true);
  // No NYSE fallback: a corp whose country has no configured venue is not
  // listed in New York, it is only on the global board.
  const exchangeLabel = getExchangeForCountry(corporation.countryId) ?? "Global";
  // ─── Shareholders pagination ──────────────────────────────────────────────
  const [page, setPage] = useState(0);

  // ─── CEO vote collapsed ───────────────────────────────────────────────────
  const [ceoVoteOpen, setCeoVoteOpen] = useState(false);

  // ─── Insider concentration penalty ───────────────────────────────────────
  const ceoEntry = corporation.ceoCharacterId
    ? corporation.shareholders.find((sh) => sh.characterId === corporation.ceoCharacterId)
    : undefined;
  const ceoOwnershipFraction =
    ceoEntry && corporation.totalShares > 0 ? ceoEntry.shares / corporation.totalShares : 0;
  const concMultiplier = insiderConcentrationMultiplier(
    ceoOwnershipFraction,
    corporation.isPrivate ?? false
  );
  const concPenaltyPct = Math.round((1 - concMultiplier) * 100);
  const showConcPenalty =
    !corporation.isPrivate && ceoOwnershipFraction > INSIDER_CONCENTRATION_THRESHOLD;

  // ─── CEO vote state ───────────────────────────────────────────────────────
  const [tallies, setTallies] = useState<VoteTally[]>([]);
  const [myVote, setMyVote] = useState<string | null>(null);
  const [votesLoaded, setVotesLoaded] = useState(false);
  const [voteLoading, setVoteLoading] = useState(false);

  useEffect(() => {
    fetchJson<{ tallies?: VoteTally[]; myVote?: string | null }>(
      `/api/corporations/${corpId}/ceo/vote`,
      { feature: "corp-ceo-vote" }
    )
      .then((d) => {
        if (d.tallies) setTallies(d.tallies);
        if (d.myVote !== undefined) setMyVote(d.myVote);
        setVotesLoaded(true);
      })
      .catch(() => setVotesLoaded(true));
  }, [corpId]);

  // ─── Pagination math ──────────────────────────────────────────────────────
  const sortedShareholders = corporation.shareholders.slice().sort((a, b) => b.shares - a.shares);
  const hasFloat = (corporation.publicFloat ?? 0) > 0;
  const totalShareholders = sortedShareholders.length;

  const page0Capacity = PAGE_SIZE - (hasFloat ? 1 : 0);
  const shareholderOffset = page === 0 ? 0 : page0Capacity + (page - 1) * PAGE_SIZE;
  const shareholdersOnPage = page === 0 ? page0Capacity : PAGE_SIZE;
  const pageSlice = sortedShareholders.slice(
    shareholderOffset,
    shareholderOffset + shareholdersOnPage
  );
  const remainingAfterPage0 = Math.max(0, totalShareholders - page0Capacity);
  const totalPages = 1 + Math.ceil(remainingAfterPage0 / PAGE_SIZE);
  const needsPagination = totalPages > 1;

  const myShares = myCharacterId
    ? (corporation.shareholders.find((sh) => sh.characterId === myCharacterId)?.shares ?? 0)
    : 0;
  const isShareholder = myShares > 0;

  // ─── CEO vote handler ─────────────────────────────────────────────────────
  function refreshTallies() {
    fetchJson<{ tallies?: VoteTally[] }>(`/api/corporations/${corpId}/ceo/vote`, {
      feature: "corp-ceo-vote",
    })
      .then((d) => setTallies(d.tallies ?? []))
      .catch(() => {});
  }

  async function handleVote(candidateCharacterId: string) {
    setVoteLoading(true);
    setActionError("");
    setActionSuccess("");
    try {
      const res = await fetch(`/api/corporations/${corpId}/ceo/vote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ candidateCharacterId }),
      });
      const data = await res.json();
      if (res.ok) {
        setMyVote(candidateCharacterId);
        setActionSuccess("Your vote has been recorded.");
        refreshTallies();
        onRefresh();
      } else {
        setActionError(data.error || "Failed to cast vote");
      }
    } catch {
      setActionError("Network error");
    } finally {
      setVoteLoading(false);
    }
  }

  async function handleWithdrawVote() {
    setVoteLoading(true);
    setActionError("");
    setActionSuccess("");
    try {
      const res = await fetch(`/api/corporations/${corpId}/ceo/vote`, { method: "DELETE" });
      const data = await res.json();
      if (res.ok) {
        setMyVote(null);
        setActionSuccess("Your vote has been withdrawn.");
        refreshTallies();
        onRefresh();
      } else {
        setActionError(data.error || "Failed to withdraw vote");
      }
    } catch {
      setActionError("Network error");
    } finally {
      setVoteLoading(false);
    }
  }

  // ─── Pie chart paths ──────────────────────────────────────────────────────
  const slices = buildSlices(corporation);
  const votingSlices = buildVotingSlices(corporation);
  const showChart = corporation.totalShares > 0;

  function buildPiePaths(sliceList: PieSlice[], totalUnits: number) {
    let cumAngle = -Math.PI / 2;
    return sliceList.map((slice, i) => {
      const angle = totalUnits > 0 ? (slice.shares / totalUnits) * 2 * Math.PI : 0;
      const startAngle = cumAngle;
      const endAngle = cumAngle + angle;
      cumAngle = endAngle;

      if (angle >= 2 * Math.PI - 0.001) {
        return <circle key={i} cx={PIE_CX} cy={PIE_CY} r={PIE_R} fill={slice.color} />;
      }

      const x1 = PIE_CX + PIE_R * Math.cos(startAngle);
      const y1 = PIE_CY + PIE_R * Math.sin(startAngle);
      const x2 = PIE_CX + PIE_R * Math.cos(endAngle);
      const y2 = PIE_CY + PIE_R * Math.sin(endAngle);
      const largeArc = angle > Math.PI ? 1 : 0;

      return (
        <path
          key={i}
          d={`M ${PIE_CX} ${PIE_CY} L ${x1} ${y1} A ${PIE_R} ${PIE_R} 0 ${largeArc} 1 ${x2} ${y2} Z`}
          fill={slice.color}
          stroke="var(--color-card)"
          strokeWidth={1.5}
        />
      );
    });
  }

  const piePaths = buildPiePaths(slices, corporation.totalShares);
  const tvp = totalVotingPower(corporation as Parameters<typeof totalVotingPower>[0]);
  const votingPiePaths = votingSlices ? buildPiePaths(votingSlices, tvp) : null;

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="rounded-xl border border-card-border bg-card p-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-5">
        <h2 className="text-lg font-bold text-foreground">Market Overview</h2>
        {(onTrade || onIssue) && (
          <div className="flex items-center gap-2 shrink-0">
            {onTrade && (
              <button
                onClick={onTrade}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary/90 transition-colors"
              >
                Trade
              </button>
            )}
            {onIssue && (
              <button
                onClick={onIssue}
                className="rounded-lg border border-card-border bg-card-elevated px-4 py-2 text-sm font-semibold text-foreground hover:bg-card-muted transition-colors"
              >
                Issue Shares
              </button>
            )}
          </div>
        )}
      </div>

      {/* Live price header — market terminal identity */}
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3 rounded-lg border border-card-border bg-card-elevated/20 px-4 py-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold uppercase tracking-widest text-muted">
              {exchangeLabel}
            </span>
            <LiveBadge exchange={exchangeLabel} />
          </div>
          <div className="mt-1 flex items-end gap-2">
            <span className="font-mono text-3xl font-bold tabular-nums text-foreground">
              {fmtPrice(corporation.sharePrice)}
            </span>
            {dayChange && <Change pct={dayChange.changePct} className="mb-1.5" />}
            {showConcPenalty && (
              <span
                className="mb-1.5 text-xs font-medium text-warning border border-warning/30 bg-warning/10 rounded px-1.5 py-0.5 cursor-default"
                title={`Insider concentration: CEO holds ${(ceoOwnershipFraction * 100).toFixed(1)}% — share price reduced by ${concPenaltyPct}% (applies above ${INSIDER_CONCENTRATION_THRESHOLD * 100}%)`}
              >
                −{concPenaltyPct}% conc.
              </span>
            )}
          </div>
          {dayChange && (
            <div className="mt-0.5 text-[11px] text-muted">
              prev close{" "}
              <span className="tabular-nums text-foreground">{fmtPrice(dayChange.prevClose)}</span>
            </div>
          )}
        </div>
        {priceSeries.length >= 2 && (
          <Sparkline data={priceSeries} w={220} h={56} up={(dayChange?.changePct ?? 0) >= 0} />
        )}
      </div>

      {/* Stats strip — unified container with dividers */}
      <div className="grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-card-border border border-card-border rounded-lg overflow-hidden mb-6 bg-card-elevated/20">
        <div className="px-4 py-3">
          <div className="text-xs text-muted mb-1">Total Shares</div>
          <div className="text-sm font-semibold text-foreground tabular-nums">
            {/* ?? 0: totalShares is stripped by redactPrivateCorporation for
                non-CEO viewers of private corps (GlitchTip AHD-A1). */}
            {(corporation.totalShares ?? 0).toLocaleString("en-US")}
          </div>
        </div>
        <div className="px-4 py-3">
          <div className="text-xs text-muted mb-1">Public Float</div>
          <div
            className={`text-sm font-semibold tabular-nums ${(corporation.publicFloat ?? 0) > 0 ? "text-success" : "text-muted"}`}
          >
            {(corporation.publicFloat ?? 0).toLocaleString("en-US")}
          </div>
          <div className="text-xs text-muted">available</div>
        </div>
        <div className="px-4 py-3">
          <div className="text-xs text-muted mb-1">Market Cap</div>
          <div className="text-sm font-semibold text-foreground tabular-nums">
            {fmtAmount(corporation.marketCapitalization)}
          </div>
        </div>
      </div>

      {/* Pie chart + Shareholders table */}
      {showChart && (
        <div className="border-t border-card-border/60 pt-5 flex flex-col sm:flex-row gap-0 sm:divide-x sm:divide-card-border">
          {/* Left: pie chart(s) + legend */}
          <div className="flex flex-col items-center pb-4 sm:pb-0 sm:pr-6 shrink-0">
            <div className={`flex gap-6 ${votingPiePaths ? "flex-row" : "flex-col items-center"}`}>
              {/* Economic ownership pie */}
              <div className="flex flex-col items-center">
                {votingPiePaths && (
                  <span className="text-xs font-medium text-muted mb-1">Economic</span>
                )}
                {!votingPiePaths && (
                  <span className="self-start text-sm font-semibold text-foreground mb-2">
                    Ownership
                  </span>
                )}
                <svg
                  viewBox={`0 0 ${PIE_SIZE} ${PIE_SIZE}`}
                  className="w-28 h-28"
                  aria-hidden="true"
                >
                  {piePaths}
                </svg>
              </div>
              {/* Voting power pie — only when supershares are active */}
              {votingPiePaths && (
                <div className="flex flex-col items-center">
                  <span className="text-xs font-medium text-muted mb-1">Voting</span>
                  <svg
                    viewBox={`0 0 ${PIE_SIZE} ${PIE_SIZE}`}
                    className="w-28 h-28"
                    aria-hidden="true"
                  >
                    {votingPiePaths}
                  </svg>
                </div>
              )}
            </div>
            <div className="mt-3 flex flex-wrap justify-center gap-x-4 gap-y-1.5 max-w-[260px]">
              {slices.map((slice, i) => (
                <div key={i} className="flex items-center gap-1.5">
                  <span
                    className="inline-block h-2.5 w-2.5 rounded-sm shrink-0"
                    style={{ backgroundColor: slice.color }}
                  />
                  <span className="text-xs text-muted truncate max-w-[90px]">{slice.label}</span>
                </div>
              ))}
            </div>
            {votingPiePaths && (
              <p className="text-[10px] text-muted mt-2 text-center max-w-[260px]">
                {corporation.superShareMultiplier}× supershares — voting differs from economic stake
              </p>
            )}
          </div>

          {/* Right: shareholders list */}
          <div className="flex-1 min-w-0 pt-4 sm:pt-0 sm:pl-6 border-t border-card-border sm:border-t-0">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-semibold text-foreground">Shareholders</span>
              {needsPagination && (
                <span className="text-xs text-muted">
                  {page + 1} / {totalPages}
                </span>
              )}
            </div>

            {totalShareholders === 0 && !hasFloat ? (
              <p className="text-sm text-muted">No shareholders on record.</p>
            ) : (
              <div className="divide-y divide-card-border/50">
                {/* Public float row (page 0 only) */}
                {hasFloat && page === 0 && (
                  <div className="flex items-center justify-between py-2.5 gap-4">
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="h-7 w-7 rounded-lg bg-success/15 border border-success/30 flex items-center justify-center shrink-0">
                        <span className="text-xs font-bold text-success">PF</span>
                      </div>
                      <div>
                        <div className="text-sm font-medium text-success">Public Float</div>
                        <div className="text-xs text-muted">Available to buy</div>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-sm font-medium text-foreground tabular-nums">
                        {(corporation.publicFloat ?? 0).toLocaleString("en-US")}
                      </div>
                      <div className="text-xs text-muted">
                        {corporation.totalShares > 0
                          ? (
                              ((corporation.publicFloat ?? 0) / corporation.totalShares) *
                              100
                            ).toFixed(2)
                          : "0.00"}
                        %
                      </div>
                    </div>
                  </div>
                )}

                {/* Shareholder rows */}
                {pageSlice.map((sh) => {
                  const pct =
                    corporation.totalShares > 0 ? (sh.shares / corporation.totalShares) * 100 : 0;
                  const isCorporateShareholder = sh.corporationId != null && sh.characterId == null;
                  const isFund = sh.isFund === true;
                  const isNppOrFund = sh.isNpp === true;
                  const rowKey =
                    sh.fundSlug ?? sh.corporationId ?? sh.characterId ?? `unknown-${sh.shares}`;
                  const hasVotedFor =
                    !isCorporateShareholder && !isNppOrFund && myVote === sh.characterId;
                  const voteCount =
                    !isCorporateShareholder && !isNppOrFund
                      ? tallies.find((t: VoteTally) => t.characterId === sh.characterId)?.votes
                      : undefined;
                  // Residency gate, with the sitting CEO exempt — mirrors the
                  // server rule. Without the exemption a CEO who moved state,
                  // or whose corp moved its HQ, showed no Vote button on their
                  // own row and could not be re-affirmed by anyone.
                  const isSeatedCeo =
                    sh.characterId != null && sh.characterId === corporation.ceoCharacterId;
                  const isVoteEligible =
                    !isCorporateShareholder &&
                    !sh.isImperial &&
                    !isNppOrFund &&
                    (isSeatedCeo ||
                      (sh.homeState === corporation.headquartersState &&
                        sh.countryId === corporation.countryId));
                  return (
                    <div key={rowKey} className="py-2.5">
                      <div className="flex items-center justify-between gap-4">
                        {isCorporateShareholder ? (
                          <Link
                            href={`/corporation/${sh.sequentialId ?? sh.corporationId}`}
                            className="flex items-center gap-2 hover:opacity-80 transition-opacity min-w-0"
                          >
                            <Avatar
                              url={sh.logoUrl}
                              name={sh.name}
                              size="h-7 w-7"
                              className="rounded-lg shrink-0"
                            />
                            <div className="min-w-0">
                              <span className="text-sm font-medium text-primary truncate block">
                                {sh.name}
                              </span>
                            </div>
                          </Link>
                        ) : isFund && sh.fundSlug ? (
                          <Link
                            href={
                              sh.fundScope === "country" && sh.fundCountryId
                                ? `/stockmarket/${sh.fundCountryId.toLowerCase()}/fund/${sh.fundSlug}`
                                : `/stockmarket/global/fund/${sh.fundSlug}`
                            }
                            className="flex items-center gap-2 hover:opacity-80 transition-opacity min-w-0"
                          >
                            <div className="h-7 w-7 rounded-lg bg-card-elevated border border-card-border flex items-center justify-center shrink-0">
                              <span className="text-xs font-bold text-muted">IF</span>
                            </div>
                            <div className="min-w-0">
                              <span className="text-sm font-medium text-primary truncate block">
                                {sh.name}
                              </span>
                            </div>
                          </Link>
                        ) : isNppOrFund ? (
                          <div className="flex items-center gap-2 min-w-0">
                            <div className="h-7 w-7 rounded-lg bg-card-elevated border border-card-border flex items-center justify-center shrink-0">
                              <span className="text-xs font-bold text-muted">
                                {sh.isNpp ? "NP" : "IF"}
                              </span>
                            </div>
                            <div className="min-w-0">
                              <span className="text-sm font-medium text-muted truncate block">
                                {sh.name}
                              </span>
                            </div>
                          </div>
                        ) : (
                          <Link
                            href={`/character/${sh.sequentialId ?? sh.characterId}`}
                            className="flex items-center gap-2 hover:opacity-80 transition-opacity min-w-0"
                          >
                            <Avatar
                              url={sh.avatarUrl}
                              name={sh.name}
                              size="h-7 w-7"
                              className="rounded-lg shrink-0"
                              borderKey={sh.borderKey}
                              tintColor={sh.tintColor}
                            />
                            <div className="min-w-0">
                              <span className="text-sm font-medium text-primary truncate block">
                                {sh.name}
                              </span>
                              {votesLoaded && voteCount !== undefined && (
                                <span className="text-xs text-muted">
                                  {voteCount.toLocaleString("en-US")} vote
                                  {voteCount !== 1 ? "s" : ""}
                                </span>
                              )}
                            </div>
                          </Link>
                        )}
                        <div className="flex items-center gap-3 shrink-0">
                          {myCharacterId &&
                            isShareholder &&
                            sh.characterId != null &&
                            isVoteEligible && (
                              <button
                                onClick={() =>
                                  hasVotedFor
                                    ? void handleWithdrawVote()
                                    : void handleVote(sh.characterId as string)
                                }
                                disabled={voteLoading}
                                title={
                                  hasVotedFor ? "Withdraw your vote" : `Vote for ${sh.name} as CEO`
                                }
                                className={`text-xs px-2 py-1 rounded-md transition-colors ${
                                  hasVotedFor
                                    ? "bg-primary/20 text-primary border border-primary/40 hover:bg-primary/30"
                                    : "border border-card-border text-muted hover:text-foreground hover:border-primary/50 disabled:opacity-50"
                                }`}
                              >
                                {hasVotedFor ? "Voted (undo)" : "Vote CEO"}
                              </button>
                            )}
                          <div className="text-right">
                            <div className="text-sm font-medium text-foreground tabular-nums">
                              {sh.shares.toLocaleString("en-US")}
                            </div>
                            <div className="text-xs text-muted">{pct.toFixed(2)}%</div>
                          </div>
                        </div>
                      </div>
                      <div className="mt-1.5">
                        <Meter value={pct} tone="brand" height={4} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Pagination controls */}
            {needsPagination && (
              <div className="flex items-center justify-center gap-2 mt-3 pt-3 border-t border-card-border">
                <button
                  onClick={() => setPage(0)}
                  disabled={page === 0}
                  className="text-xs text-muted hover:text-foreground disabled:opacity-40 transition-colors"
                >
                  ← First
                </button>
                <button
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  disabled={page === 0}
                  className="text-xs text-muted hover:text-foreground disabled:opacity-40 transition-colors px-2"
                >
                  Prev
                </button>
                <span className="text-xs text-muted px-2">
                  {page + 1} / {totalPages}
                </span>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                  disabled={page >= totalPages - 1}
                  className="text-xs text-muted hover:text-foreground disabled:opacity-40 transition-colors px-2"
                >
                  Next
                </button>
                <button
                  onClick={() => setPage(totalPages - 1)}
                  disabled={page >= totalPages - 1}
                  className="text-xs text-muted hover:text-foreground disabled:opacity-40 transition-colors"
                >
                  Last →
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* CEO Vote Tally — collapsible */}
      {votesLoaded && tallies.length > 0 && (
        <div className="mt-6 pt-6 border-t border-card-border">
          <button
            onClick={() => setCeoVoteOpen((v) => !v)}
            className="flex items-center justify-between w-full text-left group"
          >
            <h3 className="text-sm font-semibold text-foreground">CEO Vote Tally</h3>
            <span className="text-xs text-muted group-hover:text-foreground transition-colors select-none">
              {ceoVoteOpen ? "Hide ▲" : "Show ▼"}
            </span>
          </button>

          {ceoVoteOpen && (
            <>
              <p className="text-xs text-muted mt-2 mb-3">
                Shareholders vote for their preferred CEO, weighted by voting power (supershares
                count for dual-class corps). The leading candidate is offered the position.
                Candidates must be in the HQ state, except the sitting CEO, who stays votable
                wherever they live. You can change or withdraw your vote at any time.
              </p>
              <div className="space-y-1">
                {tallies.map((t: VoteTally, i: number) => (
                  <div key={t.characterId} className="flex items-center justify-between py-2 gap-4">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-xs text-muted w-4 shrink-0">{i + 1}.</span>
                      <Avatar
                        url={t.avatarUrl}
                        name={t.name}
                        size="h-7 w-7"
                        className="rounded-lg shrink-0"
                      />
                      <Link
                        href={`/character/${t.sequentialId ?? t.characterId}`}
                        className="text-sm font-medium text-primary hover:opacity-80 transition-opacity truncate"
                      >
                        {t.name}
                      </Link>
                      {corporation.pendingCeoCharacterId === t.characterId && (
                        <span className="text-xs bg-warning/20 text-warning border border-warning/30 rounded-full px-2 py-0.5 shrink-0">
                          Offered
                        </span>
                      )}
                      {myVote === t.characterId && (
                        <span className="text-xs bg-primary/15 text-primary border border-primary/30 rounded-full px-2 py-0.5 shrink-0">
                          Your vote
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      {myVote === t.characterId && (
                        <button
                          onClick={() => void handleWithdrawVote()}
                          disabled={voteLoading}
                          className="text-xs px-2 py-1 rounded-md border border-card-border text-muted hover:text-foreground hover:border-primary/50 transition-colors disabled:opacity-50"
                        >
                          Withdraw
                        </button>
                      )}
                      <span className="text-sm font-medium text-foreground tabular-nums">
                        {t.votes.toLocaleString("en-US")} vote{t.votes !== 1 ? "s" : ""}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
