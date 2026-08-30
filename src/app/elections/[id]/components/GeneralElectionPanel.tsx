"use client";

import React, { useState, useCallback, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/ui";
import { useToast } from "@/contexts/ToastContext";
import { GeneralVoteCharts, type LineSeries } from "./ElectionDetailCharts";
import { buildGeneralColors } from "@/lib/utils/politics";
import type { CandidateDetail, GeneralVotes } from "./ElectionDetailTypes";
import type { BlendClockRow } from "@/lib/elections/blendDetailViewModel";
import type { RegionElectorate } from "@/lib/elections/blendRegionViewModel";
import { KeyInsightsPanel } from "./KeyInsightsPanel";
import { StateByStateResultsTable } from "./StateByStateResultsTable";
import { PresidentialWinnerBanner } from "./PresidentialWinnerBanner";
import { ElectoralCollegeBar } from "./ElectoralCollegeBar";
import { PresidentialCandidateTable } from "./PresidentialCandidateTable";
import { CandidateComparisonCards } from "./CandidateComparisonCards";
import { NonPresidentialResultsPanel } from "./NonPresidentialResultsPanel";
import { ContingentElectionPanel } from "./ContingentElectionPanel";
import {
  assessContingentEvRisk,
  isContingentResolutionMode,
  PRESIDENTIAL_EV_NEEDED,
  electoralMajorityFor,
  collegeSizeFromEvByState,
  resolvePresidentialWinnerCandidateId,
} from "@/lib/elections/presidentialResolutionDisplay";
import { ContingentRiskBanner } from "./ContingentRiskBanner";
import { ContingentResolutionPendingBanner } from "./ContingentResolutionPendingBanner";
import {
  CAMPAIGN_STRENGTH_CONTRIBUTION_NPI_MULTIPLIER,
  campaignStrengthContributionActions,
  campaignStrengthContributionCost,
} from "@/lib/campaigns/campaignStrength";
import { campaignLocalRate, getCampaignCurrency } from "@/lib/campaigns/campaignCurrency";
import { formatCurrencyFaceAmount } from "@/lib/currency/formatCurrencyFaceAmount";
import type { CurrencyCode } from "@/lib/constants/currencies";

export function GeneralElectionPanel({
  tally,
  candidates,
  isEnded,
  totalSeats,
  electionType = "governor",
  electionId,
  myCharId,
  myEndorsedCandidateId: initialEndorsedId,
  countryId = "US",
  afterTally,
  regionName,
  countryName,
  year,
  clockRows,
  electorate,
  partyDisplayById,
}: {
  tally: GeneralVotes;
  candidates: CandidateDetail[];
  isEnded: boolean;
  totalSeats: number | null;
  electionType?:
    "senate" | "house" | "stateSenate" | "governor" | "president" | "commons" | (string & {});
  electionId?: string;
  myCharId?: string | null;
  myEndorsedCandidateId?: string | null;
  countryId?: "US" | "UK" | "DE";
  /** Rendered between the tally and the trend charts (non-presidential). */
  afterTally?: React.ReactNode;
  /** Blend detail chrome — region, country and year for the verdict hero. */
  regionName?: string;
  countryName?: string;
  year?: number | null;
  /** Deadline rows for the Clock card, built by the caller from the game clock. */
  clockRows?: BlendClockRow[];
  /** Region electorate for the turnout fact. */
  electorate?: RegionElectorate;
  /** Party abbreviations, from the response's `partyDisplayById`. */
  partyDisplayById?: Record<string, { abbr: string; color: string }>;
}) {
  const router = useRouter();
  const { showToast } = useToast();
  const [endorsedCandidateId, setEndorsedCandidateId] = useState<string | null>(
    initialEndorsedId ?? null
  );
  const [endorsing, setEndorsing] = useState(false);
  const [supportingCampaignId, setSupportingCampaignId] = useState<string | null>(null);
  const [supporting, setSupporting] = useState(false);
  const [supportError, setSupportError] = useState("");
  const [supportResult, setSupportResult] = useState<{
    strengthAdded: number;
    costFunds: number;
    costActions: number;
    currencyCode: CurrencyCode;
  } | null>(null);
  const [campaignStrengthOverrides, setCampaignStrengthOverrides] = useState<
    Record<string, number>
  >({});
  const [myNationalInfluence, setMyNationalInfluence] = useState<number | null>(null);

  const isPresident = electionType === "president";
  // Endorsement used to be presidential-only in this panel even though
  // `POST /api/elections/[id]/endorse` accepts any race, so a Senate or House
  // general offered no way to endorse from the page it happens on.
  const canEndorse = !!myCharId && !isEnded && !!electionId;
  const canSupport = isPresident && !!myCharId && !isEnded;

  // Contributor NPI for the Support Campaign cost preview (same source as the
  // campaign-page CampaignStrengthPanel).
  useEffect(() => {
    if (!myCharId) {
      setMyNationalInfluence(null);
      return;
    }
    let cancelled = false;
    fetch("/api/auth/me")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled) return;
        setMyNationalInfluence(data?.user?.character?.nationalInfluence ?? null);
      })
      .catch(() => {
        if (!cancelled) setMyNationalInfluence(null);
      });
    return () => {
      cancelled = true;
    };
  }, [myCharId]);

  const supportPreview = useMemo(() => {
    if (!supportingCampaignId || myNationalInfluence == null || myNationalInfluence <= 0) {
      return null;
    }
    const target = candidates.find((c) => c.campaignId === supportingCampaignId);
    const currentCS =
      campaignStrengthOverrides[supportingCampaignId] ?? target?.campaignStrength ?? 0;
    const strengthAdded = myNationalInfluence * CAMPAIGN_STRENGTH_CONTRIBUTION_NPI_MULTIPLIER;
    const costFundsAnchor = campaignStrengthContributionCost(currentCS, strengthAdded);
    const currencyCode = getCampaignCurrency(countryId);
    const costFunds = Math.round(costFundsAnchor * campaignLocalRate(countryId));
    return {
      strengthAdded,
      costFunds,
      costActions: campaignStrengthContributionActions(strengthAdded),
      currencyCode,
    };
  }, [supportingCampaignId, myNationalInfluence, candidates, campaignStrengthOverrides, countryId]);

  const handleEndorse = useCallback(
    async (electionCandidateId: string) => {
      if (!electionId || endorsing) return;

      // If already endorsed this candidate, withdraw. endorsedCandidateId
      // and electionCandidateId are both electionCandidates row ids.
      const isWithdraw = endorsedCandidateId === electionCandidateId;

      setEndorsing(true);
      try {
        if (isWithdraw) {
          const res = await fetch(`/api/elections/${electionId}/endorse`, { method: "DELETE" });
          if (res.ok) {
            setEndorsedCandidateId(null);
            showToast("Endorsement withdrawn", "info");
          } else {
            const data = await res.json();
            showToast(data.error ?? "Failed to withdraw endorsement", "error");
          }
        } else {
          const res = await fetch(`/api/elections/${electionId}/endorse`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ candidateId: electionCandidateId }),
          });
          const data = await res.json();
          if (res.ok) {
            setEndorsedCandidateId(data.endorsement.candidateId);
            showToast("Endorsement recorded", "success");
          } else {
            showToast(data.error ?? "Failed to endorse candidate", "error");
          }
        }
      } catch {
        showToast("Network error — please try again", "error");
      } finally {
        setEndorsing(false);
      }
    },
    [electionId, endorsedCandidateId, endorsing, showToast]
  );

  const handleSupportOpen = useCallback((campaignId: string) => {
    setSupportingCampaignId(campaignId);
    setSupportError("");
    setSupportResult(null);
  }, []);

  const handleSupportConfirm = useCallback(async () => {
    if (!supportingCampaignId || supporting) return;
    setSupporting(true);
    setSupportError("");
    try {
      const res = await fetch(`/api/campaigns/${supportingCampaignId}/campaign-strength`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) {
        setSupportError(data.error ?? "Failed to contribute");
        return;
      }
      if (supportingCampaignId != null && data.campaignStrength != null) {
        setCampaignStrengthOverrides((prev: Record<string, number>) => ({
          ...prev,
          [supportingCampaignId]: data.campaignStrength,
        }));
      }
      setSupportResult({
        strengthAdded: data.strengthAdded,
        costFunds: data.costFunds,
        costActions: data.costActions,
        currencyCode:
          (data.currencyCode as CurrencyCode | undefined) ?? getCampaignCurrency(countryId),
      });
      router.refresh();
    } catch {
      setSupportError("Network error");
    } finally {
      setSupporting(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supportingCampaignId, router, countryId]);

  const totalVotesCast = Object.values(tally.totalVotes).reduce((s, v) => s + v, 0);
  const grandTotal = Math.max(1, totalVotesCast);

  const electoralVotes = tally.electoralVotesByCandidate;

  const sorted = [...candidates].sort((a, b) => {
    if (isPresident && electoralVotes) {
      return (electoralVotes[b.id] ?? 0) - (electoralVotes[a.id] ?? 0);
    }
    return (tally.totalVotes[b.id] ?? 0) - (tally.totalVotes[a.id] ?? 0);
  });
  const colorMap = buildGeneralColors(sorted);

  // The vote-share donut went with the Blend layout: the count now leads with
  // the share as a large serif figure per candidate, and a second reading of
  // the same split earned no room.
  const lineSeries: LineSeries[] = sorted.map((c) => ({
    id: c.id,
    name: c.characterName,
    color: colorMap.get(c.id)!,
  }));

  // Presidential election - enhanced table view
  if (isPresident) {
    // Era-aware college: sum the active apportionment's per-state EVs (531 on
    // 1950s worlds, 538 modern) and take its majority; fall back to the modern
    // constants when the payload predates evByState.
    const liveCollege = collegeSizeFromEvByState(tally.evByState);
    const totalEV = liveCollege > 0 ? liveCollege : 538;
    const evNeeded = liveCollege > 0 ? electoralMajorityFor(liveCollege) : PRESIDENTIAL_EV_NEEDED;
    const contingentRisk =
      !isEnded && electoralVotes ? assessContingentEvRisk(electoralVotes, evNeeded) : null;

    const winnerCandidateId = resolvePresidentialWinnerCandidateId(
      electoralVotes,
      tally.resolutionMode,
      tally.contingentResult,
      evNeeded
    );
    const winner =
      isEnded && winnerCandidateId
        ? (sorted.find((c) => c.id === winnerCandidateId) ?? null)
        : null;

    return (
      <div className="space-y-4">
        {isEnded &&
          (tally.contingentResolutionPending || tally.executiveSeatingPending) &&
          !winner && (
            <ContingentResolutionPendingBanner
              phase={
                tally.executiveSeatingPending && !tally.contingentResolutionPending
                  ? "seating"
                  : "ballot"
              }
            />
          )}

        {contingentRisk?.atRisk && (
          <ContingentRiskBanner risk={contingentRisk} candidateNames={tally.candidateNames} />
        )}

        {/* Winner Announcement Banner (only when resolved) */}
        {isEnded && winner && (
          <PresidentialWinnerBanner
            winner={winner}
            winnerColor={colorMap.get(winner.id)!}
            electoralVotes={electoralVotes!}
            popularVotePct={((tally.totalVotes[winner.id] ?? 0) / grandTotal) * 100}
            resolutionMode={tally.resolutionMode}
            contingentResult={tally.contingentResult}
          />
        )}

        {/* Unified Electoral Vote Distribution Bar */}
        {electoralVotes && (
          <ElectoralCollegeBar
            sorted={sorted}
            colorMap={colorMap}
            electoralVotes={electoralVotes}
            isEnded={isEnded}
            evNeeded={evNeeded}
            totalEV={totalEV}
            winnerCandidateId={winnerCandidateId}
          />
        )}

        {isEnded &&
          tally.contingentResult &&
          electoralVotes &&
          isContingentResolutionMode(tally.resolutionMode) && (
            <ContingentElectionPanel
              contingentResult={tally.contingentResult}
              resolutionMode={tally.resolutionMode}
              candidates={sorted}
              candidateNames={tally.candidateNames}
              colorMap={colorMap}
              electoralVotes={electoralVotes}
            />
          )}

        {/* Detailed stats table */}
        <PresidentialCandidateTable
          sorted={sorted}
          colorMap={colorMap}
          tally={tally}
          grandTotal={grandTotal}
          totalVotesCast={totalVotesCast}
          isEnded={isEnded}
          electoralVotes={electoralVotes}
          winnerCandidateId={winnerCandidateId}
          canEndorse={canEndorse}
          endorsedCandidateId={endorsedCandidateId}
          endorsing={endorsing}
          onEndorse={handleEndorse}
          canSupport={canSupport}
          supporting={supporting}
          onSupport={handleSupportOpen}
          campaignStrengthOverrides={campaignStrengthOverrides}
          showCampaignStrength={isPresident}
        />

        {/* Charts */}
        <div className="rounded-xl border border-card-border bg-card p-4 sm:p-5">
          <div className="text-sm font-semibold mb-3">Election Trends</div>
          <GeneralVoteCharts
            snapshots={tally.turnSnapshots}
            series={lineSeries}
            evByTurn={tally.evByTurn}
          />
        </div>

        {/* Enhanced Resolved Election Display */}
        {isEnded && tally.stateVoteData && (
          <>
            {/* Candidate Comparison Cards */}
            <CandidateComparisonCards
              sorted={sorted}
              colorMap={colorMap}
              tally={tally}
              grandTotal={grandTotal}
              electoralVotes={electoralVotes}
              winner={winner}
            />

            {/* Key Insights Panel */}
            <KeyInsightsPanel
              tally={tally}
              candidates={sorted}
              colorMap={colorMap}
              electoralVotes={electoralVotes}
            />

            {/* State-by-State Results Table */}
            <StateByStateResultsTable tally={tally} candidates={sorted} colorMap={colorMap} />
          </>
        )}

        {/* Support Campaign Modal */}
        <Modal
          open={!!supportingCampaignId}
          title="Support Campaign"
          onClose={() => {
            if (!supporting) {
              setSupportingCampaignId(null);
              setSupportResult(null);
              setSupportError("");
            }
          }}
        >
          <div className="space-y-4 text-sm">
            {supportResult ? (
              <div className="space-y-2">
                <p className="text-success text-sm font-medium">Contribution successful!</p>
                <p className="text-muted text-xs">
                  Added{" "}
                  <span className="text-foreground font-medium">
                    {supportResult.strengthAdded.toFixed(1)}
                  </span>{" "}
                  campaign strength for{" "}
                  <span className="text-amber-400 font-medium">
                    {formatCurrencyFaceAmount(supportResult.costFunds, supportResult.currencyCode)}
                  </span>{" "}
                  and{" "}
                  <span className="text-cyan-400 font-medium">
                    {supportResult.costActions} actions
                  </span>
                  .
                </p>
                <button
                  onClick={() => {
                    setSupportingCampaignId(null);
                    setSupportResult(null);
                  }}
                  className="w-full rounded-lg bg-primary/10 border border-primary/30 px-4 py-2 text-xs font-medium text-primary hover:bg-primary/20 transition-colors"
                >
                  Done
                </button>
              </div>
            ) : (
              <>
                <p className="text-muted text-xs">
                  {supportPreview ? (
                    <>
                      Spend{" "}
                      <span className="font-medium text-amber-400">
                        {formatCurrencyFaceAmount(
                          supportPreview.costFunds,
                          supportPreview.currencyCode
                        )}
                      </span>{" "}
                      and{" "}
                      <span className="font-medium text-cyan-400">
                        {supportPreview.costActions} actions
                      </span>{" "}
                      to add{" "}
                      <span className="font-medium text-primary">
                        {supportPreview.strengthAdded.toFixed(1)} strength
                      </span>
                      ?
                    </>
                  ) : (
                    <>Loading contribution cost…</>
                  )}
                </p>
                {supportError && <p className="text-error text-xs">{supportError}</p>}
                <div className="flex gap-2">
                  <button
                    onClick={handleSupportConfirm}
                    disabled={supporting || !supportPreview}
                    className="flex-1 rounded-lg bg-primary px-3 py-2 text-xs font-medium text-white hover:bg-primary/90 disabled:opacity-50 transition-colors"
                  >
                    {supporting ? "Contributing..." : "Confirm"}
                  </button>
                  <button
                    onClick={() => {
                      setSupportingCampaignId(null);
                      setSupportError("");
                    }}
                    disabled={supporting}
                    className="flex-1 rounded-lg border border-card-border px-3 py-2 text-xs font-medium text-muted hover:text-foreground transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </>
            )}
          </div>
        </Modal>
      </div>
    );
  }

  // Non-presidential elections - keep existing layout
  return (
    <NonPresidentialResultsPanel
      sorted={sorted}
      tally={tally}
      totalVotesCast={totalVotesCast}
      isEnded={isEnded}
      totalSeats={totalSeats}
      lineSeries={lineSeries}
      countryId={countryId}
      electionType={electionType}
      regionName={regionName ?? ""}
      countryName={countryName ?? ""}
      year={year ?? null}
      clockRows={clockRows ?? []}
      electorate={electorate}
      partyDisplayById={partyDisplayById}
      afterTally={afterTally}
      renderEndorse={
        canEndorse
          ? (c) => (
              <button
                type="button"
                onClick={() => handleEndorse(c.id)}
                disabled={endorsing || c.isYou}
                title={c.isYou ? "You cannot endorse yourself" : undefined}
                className={`rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-40 ${
                  endorsedCandidateId === c.id
                    ? "border-yellow-500/40 bg-yellow-500/20 text-yellow-400"
                    : "border-card-border text-muted hover:text-foreground"
                }`}
              >
                {endorsedCandidateId === c.id ? "Endorsed" : "Endorse"}
              </button>
            )
          : undefined
      }
    />
  );
}
