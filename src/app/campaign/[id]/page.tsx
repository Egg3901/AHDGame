"use client";

import { useState, useEffect, useCallback, use } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { resolveElectionYear } from "@/lib/utils/formatters";
import { Modal, Skeleton } from "@/components/ui";
import type { CampaignData } from "@/lib/campaigns/dto/campaignView";
import { CanvassingPanel } from "./components/CanvassingPanel";
import { SuspendEndorsePanel } from "./components/SuspendEndorsePanel";
import { RunningMateSurrogatePanel } from "./components/RunningMateSurrogatePanel";
import { CampaignRoomBriefing } from "./components/CampaignRoomBriefing";
import { CampaignBlendClient } from "./blend/CampaignBlendClient";
import { BLEND, BLEND_CONTAINER, FONT } from "@/components/blend/tokens";
import { BlendScope } from "@/components/blend/BlendScope";
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
  const [myFunds, setMyFunds] = useState<number | null>(null);
  const [myStoredFunds, setMyStoredFunds] = useState<number | null>(null);
  const [myFundsCurrency, setMyFundsCurrency] = useState<CurrencyCode | null>(null);
  const [myActions, setMyActions] = useState<number | null>(null);
  const [myNationalInfluence, setMyNationalInfluence] = useState<number | null>(null);
  const [myCountryId, setMyCountryId] = useState<string | null>(null);
  const [currentTurn, setCurrentTurn] = useState<number | null>(null);
  const [wire, setWire] = useState<string[]>([]);
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
      setMyCountryId((meCharacter?.countryId as string | undefined) ?? null);
    } catch {
      // non-critical: contribute card just shows "—" for available balance
    }
  }, []);

  const fetchTurn = useCallback(async () => {
    try {
      const res = await fetch("/api/game/turn/status");
      if (!res.ok) return;
      const data = await res.json();
      setCurrentTurn(typeof data?.currentTurn === "number" ? data.currentTurn : null);
    } catch {
      // non-critical: the masthead simply omits the turn readout
    }
  }, []);

  // Per-race wire headlines for the ticker. A quiet race returns an empty list
  // and the strip renders nothing.
  const fetchWire = useCallback(async (electionId: string) => {
    try {
      const res = await fetch(`/api/elections/${electionId}/wire?limit=8`);
      if (!res.ok) return;
      const data = await res.json();
      setWire(
        Array.isArray(data?.items)
          ? data.items.map((i: { headline: string }) => i.headline).filter(Boolean)
          : []
      );
    } catch {
      // non-critical: the ticker stays hidden
    }
  }, []);

  useEffect(() => {
    fetchCampaign();
    fetchMe();
    fetchTurn();
  }, [fetchCampaign, fetchMe, fetchTurn]);

  useEffect(() => {
    if (campaign?.electionId) fetchWire(campaign.electionId);
  }, [campaign?.electionId, fetchWire]);

  useEffect(() => {
    const t = setInterval(() => {
      fetchCampaign();
      fetchTurn();
    }, 60_000);
    return () => clearInterval(t);
  }, [fetchCampaign, fetchTurn]);

  async function handleRetarget(targetId: string) {
    if (!campaign) return;
    try {
      const res = await fetch(`/api/campaigns/${campaign.id}/retarget`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data.error || "Retarget failed");
        return;
      }
      await fetchCampaign();
    } catch {
      alert("Retarget failed");
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
      <div
        className={isEmbedded ? "" : "min-h-screen"}
        style={{ background: BLEND.page, color: BLEND.ink }}
      >
        <div className={BLEND_CONTAINER}>
          <Skeleton className="h-3 w-40" />
          <div className="mt-4">
            <Skeleton className="h-8 w-72" />
          </div>
          <div className="mt-3">
            <Skeleton className="h-4 w-96" />
          </div>
        </div>
        <div
          className={BLEND_CONTAINER}
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(4, 1fr)",
            borderTop: `1px solid ${BLEND.hairlineStrong}`,
          }}
        >
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              style={{
                padding: "16px 20px",
                ...(i < 3 ? { borderRight: `1px solid ${BLEND.hairline}` } : {}),
              }}
            >
              <Skeleton className="h-2.5 w-20" />
              <div className="mt-2">
                <Skeleton className="h-6 w-24" />
              </div>
              <div className="mt-2">
                <Skeleton className="h-3 w-28" />
              </div>
            </div>
          ))}
        </div>
        <div className={BLEND_CONTAINER}>
          {[0, 1, 2, 3].map((i) => (
            <div key={i} style={{ padding: "14px 0", borderBottom: "1px solid rgba(42,42,61,.6)" }}>
              <Skeleton className="h-5 w-56" />
              <div className="mt-2">
                <Skeleton className="h-2 w-full" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (error || !campaign) {
    return (
      <div
        className={isEmbedded ? "" : "min-h-screen"}
        style={{ background: BLEND.page, color: BLEND.ink }}
      >
        <div className={BLEND_CONTAINER} style={{ paddingTop: 48, paddingBottom: 48 }}>
          <div
            style={{
              padding: "14px 18px",
              borderLeft: `2px solid ${BLEND.negative}`,
              background: "rgba(255,255,255,.02)",
              fontFamily: FONT.serif,
              fontSize: 15,
              color: BLEND.negative,
            }}
          >
            {error || "Campaign not found"}
          </div>
          <Link
            href="/elections"
            style={{
              display: "inline-block",
              marginTop: 16,
              fontFamily: FONT.mono,
              fontSize: 11,
              letterSpacing: ".08em",
              textTransform: "uppercase",
              color: BLEND.muted,
            }}
          >
            &lsaquo; Back to elections
          </Link>
        </div>
      </div>
    );
  }

  const isOwner = campaign.accessLevel === "owner";
  const isRunningMate = campaign.isRunningMate === true;
  // Archived campaigns (primary loser / withdrawn) are viewable as history but
  // not manageable — owners still see their figures, but every action affordance
  // is hidden (and the server rejects mutations regardless).
  //
  // A running mate has owner-level VIEW but NOT full manage: canManage (the
  // manager/nominee surface: full ops, oppo reset, retarget, budget controls) is
  // withheld from them. Their narrower surrogate action set is gated on
  // canSurrogate instead, and the server enforces the same split.
  const canManage =
    isOwner && !isRunningMate && !campaign.isArchived && !campaign.campaignSuspended;
  const canSurrogate = isRunningMate && !campaign.isArchived && !campaign.campaignSuspended;
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
    <div
      className={isEmbedded ? "" : "min-h-screen"}
      style={{ background: BLEND.page, color: BLEND.ink }}
    >
      {!isEmbedded && campaign.electionInfo && (
        <div
          className={BLEND_CONTAINER}
          style={{
            paddingTop: 14,
            paddingBottom: 14,
            fontFamily: FONT.mono,
            fontSize: 11,
            letterSpacing: ".06em",
            textTransform: "uppercase",
          }}
        >
          <Link href={`/elections/${campaign.electionId}`} style={{ color: BLEND.muted }}>
            &lsaquo; {campaign.electionInfo.state}{" "}
            {campaign.electionInfo.electionType === "president"
              ? "Presidential"
              : campaign.electionInfo.electionType}{" "}
            Election{electionYear ? ` ${electionYear}` : ""}
          </Link>
        </div>
      )}

      {campaign.isArchived && (
        <div
          className={BLEND_CONTAINER}
          style={{
            paddingTop: 12,
            paddingBottom: 12,
            fontFamily: FONT.serif,
            fontSize: 14,
            color: BLEND.muted,
          }}
        >
          <span style={{ color: BLEND.ink, fontWeight: 600 }}>Campaign concluded.</span> This
          candidate is no longer in the race, so the campaign is read only. Funds, actions and
          upgrades can no longer be changed.
        </div>
      )}

      <CampaignBlendClient
        campaign={campaign}
        me={{
          funds: myFunds,
          storedFunds: myStoredFunds,
          actions: myActions,
          nationalInfluence: myNationalInfluence,
          fundsCurrency: myFundsCurrency,
        }}
        currentTurn={currentTurn}
        wire={wire}
        canManage={canManage}
        canSurrogate={canSurrogate}
        onRefresh={fetchCampaign}
        onRefreshMe={fetchMe}
        onRetarget={canManage ? handleRetarget : undefined}
      />

      {/*
        Deviation D11: these four surfaces exist on the live page but have no
        counterpart in the Proposal D mockup. Removing them would delete working
        affordances, so they are retained below the Blend body in their current
        styling. Restyling them into Blend is follow-up work.
      */}
      {(canManage && campaign.briefing) ||
      (isOwner && campaign.electionInfo?.electionType === "president" && !campaign.isArchived) ||
      (canSurrogate && campaign.runningMateSurrogate) ||
      (canManage && campaign.electionInfo && !campaign.electionInfo.isEnded) ? (
        <BlendScope title="Also on this campaign">
          {isOwner &&
            campaign.electionInfo?.electionType === "president" &&
            !campaign.isArchived && (
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

          {canManage && campaign.briefing && <CampaignRoomBriefing campaign={campaign} />}

          {canSurrogate &&
            campaign.runningMateSurrogate &&
            campaign.electionInfo &&
            !campaign.electionInfo.isEnded && (
              <RunningMateSurrogatePanel
                electionId={campaign.electionId}
                surrogate={campaign.runningMateSurrogate}
                countryId={myCountryId ?? undefined}
                characterActions={myActions ?? undefined}
                characterFunds={myFunds ?? undefined}
                onRefresh={fetchCampaign}
                onResourcesSpent={fetchMe}
              />
            )}

          {canManage && campaign.electionInfo && !campaign.electionInfo.isEnded && (
            <CanvassingPanel
              countryId={myCountryId ?? undefined}
              characterActions={myActions ?? undefined}
              characterFunds={myFunds ?? undefined}
              onResourcesSpent={fetchMe}
            />
          )}

          {canManage && (
            <button
              type="button"
              onClick={openResetOpposition}
              style={{
                marginTop: 8,
                border: `1px solid ${BLEND.hairlineStrong}`,
                background: "transparent",
                padding: "8px 14px",
                fontFamily: FONT.mono,
                fontSize: 10.5,
                letterSpacing: ".08em",
                fontWeight: 700,
                color: BLEND.muted,
                cursor: "pointer",
              }}
            >
              RESET OPPOSITION RESEARCH
            </button>
          )}
        </BlendScope>
      ) : null}

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
