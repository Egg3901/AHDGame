"use client";

import { useState, useEffect, useCallback, use } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { resolveElectionYear } from "@/lib/utils/formatters";
import { Modal, Skeleton } from "@/components/ui";
import { LocalTime } from "@/components/time/LocalTime";
import type { CampaignData } from "@/lib/campaigns/dto/campaignView";
import { ResourceOverview } from "./components/ResourceOverview";
import { OperationsSection } from "./components/OperationsSection";
import { BudgetSection } from "./components/BudgetSection";
import { ActivityLog } from "./components/ActivityLog";
import { CanvassingPanel } from "./components/CanvassingPanel";
import { ContributionsSection } from "./components/ContributionsSection";
import { CampaignStrengthPanel } from "./components/CampaignStrengthPanel";
import { RallyPanel } from "./components/RallyPanel";
import { SuspendEndorsePanel } from "./components/SuspendEndorsePanel";
import type { CurrencyCode } from "@/lib/constants/currencies";

export default function CampaignDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  // When embedded inside the Political Operations dashboard's iframe, suppress
  // the page chrome (min-h-screen background, breadcrumb, page-level header)
  // so the surrounding tab provides the framing instead. The standalone
  // /campaign/[id] route is unchanged.
  const searchParams = useSearchParams();
  const isEmbedded = searchParams?.get("embedded") === "political-operations";
  const [campaign, setCampaign] = useState<CampaignData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [upgrading, setUpgrading] = useState<string | null>(null);
  const [myFunds, setMyFunds] = useState<number | null>(null);
  const [myStoredFunds, setMyStoredFunds] = useState<number | null>(null);
  const [myFundsCurrency, setMyFundsCurrency] = useState<CurrencyCode | null>(null);
  const [myActions, setMyActions] = useState<number | null>(null);
  const [myNationalInfluence, setMyNationalInfluence] = useState<number | null>(null);
  const [resetOppoOpen, setResetOppoOpen] = useState(false);
  const [resetOppoBusy, setResetOppoBusy] = useState(false);
  const [resetOppoError, setResetOppoError] = useState("");

  const fetchCampaign = useCallback(async () => {
    try {
      const res = await fetch(`/api/campaigns/${id}`);
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Failed to load campaign");
        return;
      }
      const data = await res.json();
      setCampaign(data.campaign);
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }, [id]);

  const fetchMe = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/me");
      if (!res.ok) return;
      const data = await res.json();
      const meCharacter = data?.user?.character;
      // Prefer the stored local balance over the legacy anchor mirror
      // (in-game bug #0553). The mirror drifts under floating FX and can
      // block actions even when the real balance is fine.
      const storedOrLegacy = meCharacter?.campaignFundsStored ?? meCharacter?.funds ?? null;
      setMyFunds(storedOrLegacy);
      setMyStoredFunds(storedOrLegacy);
      setMyFundsCurrency((meCharacter?.homeCurrency as CurrencyCode | undefined) ?? null);
      setMyActions(meCharacter?.actions ?? null);
      setMyNationalInfluence(meCharacter?.nationalInfluence ?? null);
    } catch {
      // non-critical: contribute card just shows "—" for available balance
    }
  }, []);

  useEffect(() => {
    fetchCampaign();
    fetchMe();
  }, [fetchCampaign, fetchMe]);

  useEffect(() => {
    const t = setInterval(() => fetchCampaign(), 60_000);
    return () => clearInterval(t);
  }, [fetchCampaign]);

  async function handleUpgrade(category: string, targetId?: string) {
    if (!campaign) return;
    setUpgrading(category);
    try {
      const res = await fetch(`/api/campaigns/${campaign.id}/upgrade`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category, targetId }),
      });
      if (!res.ok) {
        const data = await res.json();
        alert(data.error || "Upgrade failed");
        return;
      }
      await fetchCampaign();
    } catch {
      alert("Upgrade failed");
    } finally {
      setUpgrading(null);
    }
  }

  function openResetOpposition() {
    setResetOppoError("");
    setResetOppoOpen(true);
  }

  async function confirmResetOpposition() {
    if (!campaign) return;
    setResetOppoBusy(true);
    setResetOppoError("");
    try {
      const res = await fetch(`/api/campaigns/${campaign.id}/opposition-research/reset`, {
        method: "POST",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setResetOppoError(data.error || "Reset failed");
        return;
      }
      setResetOppoOpen(false);
      await fetchCampaign();
    } catch {
      setResetOppoError("Network error");
    } finally {
      setResetOppoBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-background">
        <main className="mx-auto max-w-4xl px-4 py-6 sm:px-6 sm:py-8 space-y-6">
          {/* Breadcrumb */}
          <div className="flex items-center gap-2">
            <Skeleton className="h-4 w-36" />
            <Skeleton className="h-3 w-3 rounded-sm" />
            <Skeleton className="h-4 w-44" />
          </div>

          {/* Header */}
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-2 min-w-0">
              <Skeleton className="h-9 w-64" />
              <div className="flex gap-3">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-4 w-32" />
              </div>
            </div>
            <Skeleton className="h-8 w-36 rounded-lg shrink-0" />
          </div>

          {/* Resource overview */}
          <div className="rounded-xl border border-card-border bg-card p-5 space-y-4">
            <Skeleton className="h-4 w-36" />
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="space-y-1">
                  <Skeleton className="h-2.5 w-16" />
                  <Skeleton className="h-6 w-24" />
                </div>
              ))}
            </div>
            <Skeleton className="h-2 w-full rounded-full" />
          </div>

          {/* Operations section */}
          <div className="rounded-xl border border-card-border bg-card p-5 space-y-4">
            <Skeleton className="h-4 w-44" />
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="rounded-lg border border-card-border p-3 space-y-2">
                  <Skeleton className="h-3 w-20" />
                  <div className="flex items-center justify-between">
                    <Skeleton className="h-5 w-10" />
                    <Skeleton className="h-6 w-20 rounded-lg" />
                  </div>
                  <Skeleton className="h-1.5 w-full rounded-full" />
                </div>
              ))}
            </div>
          </div>

          {/* Budget section */}
          <div className="rounded-xl border border-card-border bg-card p-5 space-y-3">
            <Skeleton className="h-4 w-28" />
            <div className="grid grid-cols-2 gap-4">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="space-y-1">
                  <Skeleton className="h-2.5 w-20" />
                  <Skeleton className="h-5 w-28" />
                </div>
              ))}
            </div>
          </div>
        </main>
      </div>
    );
  }

  if (error || !campaign) {
    return (
      <div className="min-h-screen bg-background">
        <main className="mx-auto max-w-4xl px-6 py-12">
          <div className="rounded-xl border border-error/30 bg-error/10 p-6 text-center">
            <p className="text-error">{error || "Campaign not found"}</p>
            <Link
              href="/elections"
              className="mt-4 inline-block text-sm text-muted hover:text-foreground"
            >
              Back to Elections
            </Link>
          </div>
        </main>
      </div>
    );
  }

  const isOwner = campaign.accessLevel === "owner";
  // Archived campaigns (primary loser / withdrawn) are viewable as history but
  // not manageable — owners still see their figures, but every action affordance
  // is hidden (and the server rejects mutations regardless).
  const canManage = isOwner && !campaign.isArchived && !campaign.campaignSuspended;
  const electionYear = campaign.electionInfo
    ? resolveElectionYear({
        electionType: campaign.electionInfo.electionType,
        cycle: campaign.electionInfo.cycle,
        electionYear: campaign.electionInfo.electionYear,
        senateClass: campaign.electionInfo.senateClass,
        chamberClass: (campaign.electionInfo as { chamberClass?: number | null }).chamberClass,
      })
    : null;

  return (
    <div className={isEmbedded ? "" : "min-h-screen bg-background"}>
      <main
        className={
          isEmbedded
            ? "px-4 py-4 overflow-x-hidden"
            : "mx-auto max-w-4xl px-4 py-6 sm:px-6 sm:py-8 overflow-x-hidden"
        }
      >
        {!isEmbedded && (
          <>
            {/* Breadcrumb */}
            <div className="mb-6 flex items-center gap-2 text-sm">
              {campaign.electionInfo && (
                <>
                  <Link
                    href={`/elections/${campaign.electionId}`}
                    className="text-muted hover:text-foreground transition-colors flex items-center gap-1"
                  >
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M15 19l-7-7 7-7"
                      />
                    </svg>
                    {campaign.electionInfo.state}{" "}
                    {campaign.electionInfo.electionType === "president"
                      ? "Presidential"
                      : campaign.electionInfo.electionType}{" "}
                    Election
                    {electionYear ? ` (${electionYear})` : ""}
                  </Link>
                  <span className="text-card-border">/</span>
                </>
              )}
              <span className="font-medium text-foreground">
                {campaign.candidateName}&apos;s Campaign
              </span>
            </div>

            {/* Header */}
            <div className="mb-6">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <h1 className="text-3xl font-bold truncate">{campaign.candidateName}</h1>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
                    <span>{campaign.party}</span>
                    {campaign.managerName && (
                      <>
                        <span className="text-card-border">|</span>
                        <span>Manager: {campaign.managerName}</span>
                      </>
                    )}
                    {campaign.electionInfo?.isEnded && (
                      <span className="rounded-full bg-muted/20 px-2 py-0.5 text-xs font-medium text-muted">
                        Concluded
                      </span>
                    )}
                  </div>
                </div>
                {isOwner && (
                  <div className="shrink-0 rounded-lg border border-primary/30 bg-primary/5 px-3 py-1.5 text-xs font-medium text-primary">
                    Campaign Manager
                  </div>
                )}
                {campaign.accessLevel === "party" && (
                  <div className="shrink-0 rounded-lg border border-info/30 bg-info/5 px-3 py-1.5 text-xs font-medium text-info">
                    Party Intel
                  </div>
                )}
                {campaign.accessLevel === "public" && (
                  <div className="shrink-0 rounded-lg border border-card-border bg-card px-3 py-1.5 text-xs font-medium text-muted">
                    Public View
                  </div>
                )}
              </div>
            </div>
          </>
        )}

        {/* Presidential general: suspend campaigning and endorse another nominee. */}
        {isOwner && campaign.electionInfo?.electionType === "president" && !campaign.isArchived && (
          <SuspendEndorsePanel
            campaignId={campaign.id}
            campaignSuspended={campaign.campaignSuspended === true}
            suspendedAt={campaign.suspendedAt}
            endorsedCandidate={campaign.endorsedCandidate}
            endorsementTargetWithdrawn={campaign.endorsementTargetWithdrawn}
            suspendEndorse={campaign.suspendEndorse}
            onRefresh={fetchCampaign}
          />
        )}

        {/* Archived (eliminated / withdrawn) notice — read-only history. */}
        {campaign.isArchived && (
          <div className="mb-6 rounded-lg border border-muted/30 bg-muted/5 px-3 py-2 text-xs text-muted">
            <span className="font-medium text-foreground">Campaign concluded.</span> This candidate
            is no longer in the race, so the campaign is read-only — funds, actions, and upgrades
            can no longer be changed.
          </div>
        )}

        {/* Fog of war notice */}
        {!isOwner && (
          <div className="mb-6 flex items-start gap-2 rounded-lg border border-warning/20 bg-warning/5 px-3 py-2">
            <svg
              className="h-3.5 w-3.5 text-warning shrink-0 mt-0.5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            <p className="text-xs text-muted/90">
              <span className="font-medium text-warning">
                {campaign.accessLevel === "party" ? "Party Intelligence." : "Public Intelligence."}
              </span>{" "}
              Campaign levels shown are estimates based on{" "}
              {campaign.accessLevel === "party" ? "party" : "public"} intelligence.
              {campaign.fogLastUpdated && (
                <span className="text-muted/60">
                  {" "}
                  Last updated: <LocalTime value={campaign.fogLastUpdated} />
                </span>
              )}
            </p>
          </div>
        )}

        {/* Owner: Resource Overview */}
        {isOwner && campaign.funds !== undefined && <ResourceOverview campaign={campaign} />}

        {/* Campaign Levels - visible to everyone */}
        <OperationsSection
          campaign={campaign}
          isOwner={canManage}
          upgrading={upgrading}
          onUpgrade={handleUpgrade}
          onResetOppositionResearch={canManage ? openResetOpposition : undefined}
          resettingOppositionResearch={resetOppoBusy}
        />

        {/* Campaign Strength — presidential races only. Only the presidential
            election engine consumes campaignStrength; the panel was briefly
            widened to down-ballot races (Phase 5.5) where CS had zero vote
            effect, so it is gated back to president for UI honesty (#2891
            bundle). Server-side contribution is rejected for non-presidential
            races too. Hidden for archived campaigns. */}
        {!campaign.isArchived &&
          campaign.electionInfo?.electionType &&
          ["senate", "governor", "house", "stateSenate"].includes(
            campaign.electionInfo.electionType
          ) && (
            <div className="rounded-xl border border-card-border bg-card p-5 mb-6">
              <h3 className="text-sm font-semibold text-foreground">Campaign Strength</h3>
              <p className="text-xs text-muted mt-1">
                Campaign strength only affects presidential races right now, so contributions are
                disabled for this race to protect your funds and actions.
              </p>
            </div>
          )}
        {!campaign.isArchived && campaign.electionInfo?.electionType === "president" && (
          <CampaignStrengthPanel
            campaignId={campaign.id}
            campaignStrength={campaign.campaignStrength ?? 0}
            isEnded={campaign.electionInfo.isEnded}
            myNationalInfluence={myNationalInfluence}
            myActions={myActions}
            myFunds={myFunds}
            currencyCode={campaign.currencyCode}
            fxRate={campaign.fxRate}
            onContribute={() => {
              fetchCampaign();
              fetchMe();
            }}
          />
        )}

        {/* Owner: Rally Panel — Phase B Support mutation surface.
            Fog-of-war hides opponent Support entirely; this panel only
            renders for owner-access viewers and only for non-NPP candidates. */}
        {canManage && campaign.ownSupport && campaign.electionInfo && (
          <div className="mb-6">
            <RallyPanel
              campaignId={campaign.id}
              ownSupport={campaign.ownSupport}
              campaignActions={campaign.actions ?? null}
              isEnded={campaign.electionInfo.isEnded}
              onRefresh={fetchCampaign}
            />
          </div>
        )}

        {/* Owner: Canvassing Panel */}
        {canManage && campaign.electionInfo && !campaign.electionInfo.isEnded && (
          <div className="mb-6">
            <CanvassingPanel />
          </div>
        )}

        {/* Personal/treasury contribution cards (visible to candidate, manager,
            admin, or party officer of the candidate's party). Hidden once the
            campaign is archived — contributions are rejected server-side. */}
        {!campaign.isArchived && !campaign.campaignSuspended && (
          <ContributionsSection
            campaign={campaign}
            myCampaignFunds={myStoredFunds}
            myCampaignFundsCurrency={myFundsCurrency}
            onContribute={fetchCampaign}
            onUserRefresh={fetchMe}
          />
        )}

        {/* Owner: Budget Breakdown */}
        {isOwner && campaign.budget && <BudgetSection campaign={campaign} />}

        {/* Owner: Activity Log */}
        {isOwner && campaign.activityHistory && campaign.activityHistory.length > 0 && (
          <ActivityLog
            activityHistory={campaign.activityHistory}
            currencyCode={campaign.currencyCode}
          />
        )}
      </main>

      <Modal
        open={resetOppoOpen}
        title="Reset Opposition Research?"
        onClose={() => {
          if (!resetOppoBusy) setResetOppoOpen(false);
        }}
      >
        <div className="space-y-3 text-sm">
          <p>
            This will set Opposition Research back to <span className="font-semibold">level 0</span>
            , clear the current target
            {campaign.oppositionTargetName ? (
              <>
                {" "}
                (<span className="font-medium">{campaign.oppositionTargetName}</span>)
              </>
            ) : null}
            , and clear the retarget cooldown.
          </p>
          <p className="text-warning">
            Funds and actions you previously spent on Opposition Research will{" "}
            <span className="font-semibold">not</span> be refunded.
          </p>
          {resetOppoError && (
            <p className="rounded-md border border-error/30 bg-error/10 px-3 py-2 text-error">
              {resetOppoError}
            </p>
          )}
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => setResetOppoOpen(false)}
            disabled={resetOppoBusy}
            className="rounded-lg border border-card-border bg-card px-3 py-1.5 text-sm font-medium text-foreground hover:bg-card/80 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={confirmResetOpposition}
            disabled={resetOppoBusy}
            className="rounded-lg bg-error px-3 py-1.5 text-sm font-semibold text-white hover:brightness-110 disabled:opacity-60"
          >
            {resetOppoBusy ? "Resetting..." : "Reset to 0"}
          </button>
        </div>
      </Modal>
    </div>
  );
}
