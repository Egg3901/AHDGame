"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button, EmptyState } from "@/components/ui";

export interface UnionBargainingEmployer {
  corporationId: string;
  corporationName: string;
  localCount: number;
  averageWageLevel: number;
  averageUnionization: number;
  openCampaignId: string | null;
  agreementExpiresAtTurn: number | null;
  agreementWageLevel: number | null;
  agreementNoStrikeUntilTurn: number | null;
}

export interface UnionBargainingOffer {
  revision: number;
  proposedBy: "union" | "employer";
  wageLevel: number;
  agreementDurationTurns: number;
  noStrikeTurns: number;
  /** A8: share of the covered wage bill. Absent on offers made before it existed. */
  pensionContributionRate?: number;
  proposedAtTurn: number;
}

export interface UnionBargainingCampaign {
  campaignId: string;
  employerCorporationId: string;
  employerName: string;
  status: "negotiating" | "dispute" | "settled" | "withdrawn" | "lapsed";
  escalationLevel: "none" | "overtime_ban" | "selective_strike" | "industry_strike";
  /**
   * Upkeep the CURRENT level is costing per turn. Server-computed and scoped to
   * locals that still resolve, exactly as the turn charges it.
   */
  heldUpkeepPerTurn?: number;
  escalationPreview: {
    nextLevel: "overtime_ban" | "selective_strike" | "industry_strike";
    supportRequired: number;
    cashCost: number;
    newStrikeLocalCount: number;
    targetLocals: { sectorId: string; stateId: string }[];
    /** Treasury cost of every turn the level is held, once it has been called. */
    upkeepPerTurn?: number;
    /** Turn the union-wide strike-call cooldown clears, when one is running. */
    strikeCooldownUntilTurn?: number | null;
    /**
     * Why the escalate command would refuse this step right now. The server
     * computes it from the same plan the command runs, so the button is never
     * offered for an action that is already impossible.
     */
    blockedReason?: string | null;
  } | null;
  mediation: {
    wageLevel: number;
    agreementDurationTurns: number;
    noStrikeTurns: number;
    pensionContributionRate?: number;
    unionAccepted: boolean;
    employerAccepted: boolean;
    status: "pending" | "rejected" | "expired";
    expiresAtTurn: number;
  } | null;
  mediationAvailable: boolean;
  mediationUnavailableReason: string | null;
  /**
   * The members' ballot on the offer the president moved to accept. Weights are
   * the snapshot taken when the vote opened, so the numbers here do not move
   * with the per-turn strength decay while the vote is running.
   */
  ratification: UnionRatificationView | null;
  /** Why the president cannot put the current offer to the members right now. */
  ratificationBlockedReason?: string | null;
  currentOffer: UnionBargainingOffer;
  offers: UnionBargainingOffer[];
  /**
   * The whole mandate, not the two headline scores. Every one of these is
   * recomputed from live conditions each turn, so a leader watching support
   * fall has to be able to see whether it was the shop floor, the labour
   * market, a change in the law, or a drained strike fund.
   */
  mandate: BargainingMandateView;
  sectorCount: number;
  deadlineTurn: number;
  lastActionTurn: number;
  mediationAvailableTurn: number;
}

export interface UnionRatificationView {
  status: "open" | "ratified" | "rejected" | "void";
  offerRevision: number;
  openedAtTurn: number;
  closesAtTurn: number;
  closedAtTurn: number | null;
  ratifyStrength: number;
  rejectStrength: number;
  castStrength: number;
  outstandingStrength: number;
  ratifyCount: number;
  rejectCount: number;
  totalStrength: number;
  voterCount: number;
  /** The viewer's own snapshot weight. Zero means they hold no ballot here. */
  viewerWeight: number;
  viewerVote: "ratify" | "reject" | null;
}

export interface BargainingMandateView {
  support: number;
  leverage: number;
  coverage: number;
  grievance: number;
  laborTightness: number;
  lawSupport: number;
  /** Scoped strike calls the treasury can fund, capped at the scoring ceiling. */
  strikeFundRunway: number;
}

function nextEscalationFor(level: UnionBargainingCampaign["escalationLevel"]) {
  if (level === "none") return { level: "overtime_ban" as const, label: "Begin overtime ban" };
  if (level === "overtime_ban") {
    return { level: "selective_strike" as const, label: "Call selective strike" };
  }
  if (level === "selective_strike") {
    return { level: "industry_strike" as const, label: "Call industry strike" };
  }
  return null;
}

export function UnionBargainingPanel({
  unionId,
  unionTreasury,
  currentTurn,
  isLeader,
  employers,
  campaigns,
  onReload,
}: {
  unionId: string;
  unionTreasury: number;
  currentTurn: number;
  isLeader: boolean;
  employers: UnionBargainingEmployer[];
  campaigns: UnionBargainingCampaign[];
  onReload: () => Promise<void>;
}) {
  const [employerId, setEmployerId] = useState("");
  const [wage, setWage] = useState("1.10");
  const [duration, setDuration] = useState("48");
  const [noStrike, setNoStrike] = useState("24");
  // A8: percent in the field, fraction on the wire. Nobody bargains in decimals.
  const [pension, setPension] = useState("0");
  const [counterDrafts, setCounterDrafts] = useState<Record<string, UnionBargainingOffer>>({});
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    const currentEmployer = employers.find((employer) => employer.corporationId === employerId);
    if (
      !currentEmployer ||
      currentEmployer.openCampaignId ||
      currentEmployer.agreementExpiresAtTurn
    ) {
      setEmployerId(
        employers.find((employer) => !employer.openCampaignId && !employer.agreementExpiresAtTurn)
          ?.corporationId ?? ""
      );
    }
  }, [employerId, employers]);

  useEffect(() => {
    setCounterDrafts((current) => {
      const next = { ...current };
      for (const campaign of campaigns) next[campaign.campaignId] ??= campaign.currentOffer;
      return next;
    });
  }, [campaigns]);

  async function request(path: string, method: "POST" | "PATCH", body: unknown, success: string) {
    setPending(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/unions/${unionId}/${path}`, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await response.json();
      setMessage({
        ok: response.ok,
        text: response.ok ? success : (data.error ?? "Action failed."),
      });
      if (response.ok) await onReload();
    } catch {
      setMessage({ ok: false, text: "Network error. No bargaining action was recorded." });
    } finally {
      setPending(false);
    }
  }

  const propose = () =>
    request(
      "bargaining",
      "POST",
      {
        employerCorporationId: employerId,
        wageLevel: Number(wage),
        agreementDurationTurns: Number(duration),
        noStrikeTurns: Number(noStrike),
        pensionContributionRate: Number(pension) / 100,
      },
      "Bargaining campaign opened."
    );

  const activeAgreementEmployers = employers.filter(
    (employer) => employer.agreementExpiresAtTurn != null
  );

  const act = (
    campaignId: string,
    action:
      | "accept"
      | "counter"
      | "withdraw"
      | "escalate"
      | "request_mediation"
      | "accept_mediation"
      | "reject_mediation"
  ) => {
    const draft = counterDrafts[campaignId];
    return request(
      `bargaining/${campaignId}`,
      "PATCH",
      action === "counter"
        ? {
            action,
            wageLevel: Number(draft?.wageLevel),
            agreementDurationTurns: Number(draft?.agreementDurationTurns),
            noStrikeTurns: Number(draft?.noStrikeTurns),
            pensionContributionRate: draft?.pensionContributionRate,
          }
        : { action },
      "Bargaining action recorded."
    );
  };

  const castBallot = (campaignId: string, vote: "ratify" | "reject") =>
    request(
      `bargaining/${campaignId}/ratify`,
      "POST",
      { vote },
      vote === "ratify" ? "Ballot cast to ratify." : "Ballot cast to reject."
    );

  const confirmEscalation = (campaign: UnionBargainingCampaign) => {
    const preview = campaign.escalationPreview;
    if (!preview) return;
    const targetList = preview.targetLocals.map((local) => local.stateId).join(", ") || "none";
    const upkeep = preview.upkeepPerTurn ?? 0;
    const confirmed = window.confirm(
      `${nextEscalationFor(campaign.escalationLevel)?.label ?? "Escalate dispute"}?\n\n` +
        `Treasury cost: ${preview.cashCost.toLocaleString("en-US")}\n` +
        (upkeep > 0
          ? `Upkeep while held: ${upkeep.toLocaleString("en-US")} per turn (the action ends by itself if the treasury cannot pay)\n`
          : "") +
        `Affected locals: ${targetList}\n` +
        `New strike calls: ${preview.newStrikeLocalCount}`
    );
    if (confirmed) void act(campaign.campaignId, "escalate");
  };

  return (
    <div className="space-y-5">
      {message && (
        <p
          role={message.ok ? "status" : "alert"}
          className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-body font-medium ${
            message.ok
              ? "border-success/30 bg-success/10 text-success"
              : "border-error/30 bg-error/10 text-error"
          }`}
        >
          <span aria-hidden>{message.ok ? "✓" : "⚠"}</span>
          <span>{message.text}</span>
        </p>
      )}

      {isLeader && (
        <div className="rounded-xl border border-card-border bg-card p-5 space-y-4">
          <div>
            <h3 className="text-heading-sm font-semibold text-foreground">
              Open a bargaining campaign
            </h3>
            <p className="mt-1 text-body text-muted">
              Choose one employer. The campaign covers every local it operates in this union&apos;s
              country and industry.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="text-body-sm text-muted sm:col-span-2 lg:col-span-1">
              Employer
              <select
                value={employerId}
                onChange={(event) => setEmployerId(event.target.value)}
                className="mt-1 w-full rounded-lg border border-card-border bg-background px-3 py-2 text-body text-foreground"
              >
                {employers.map((employer) => (
                  <option
                    key={employer.corporationId}
                    value={employer.corporationId}
                    disabled={!!employer.openCampaignId || !!employer.agreementExpiresAtTurn}
                  >
                    {employer.corporationName} ({employer.localCount} locals,{" "}
                    {employer.averageUnionization.toFixed(0)}% organized
                    {employer.agreementExpiresAtTurn
                      ? `, agreement to turn ${employer.agreementExpiresAtTurn}`
                      : ""}
                    )
                  </option>
                ))}
              </select>
            </label>
            <NumberField
              label="Wage floor"
              value={wage}
              step="0.01"
              min="0.8"
              max="1.5"
              onChange={setWage}
            />
            <NumberField
              label="Agreement turns"
              value={duration}
              step="1"
              min="24"
              max="192"
              onChange={setDuration}
            />
            <NumberField
              label="No-strike turns"
              value={noStrike}
              step="1"
              min="0"
              max={duration}
              onChange={setNoStrike}
            />
            <NumberField
              label="Pension %"
              value={pension}
              step="0.5"
              min="0"
              max="15"
              onChange={setPension}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Button
              className="w-fit"
              disabled={pending || !employerId}
              onClick={() => void propose()}
            >
              Open campaign
            </Button>
            {!employerId && (
              <span className="text-body-sm text-muted">
                {employers.length === 0
                  ? "No employer operates a local of this industry in this country yet."
                  : "Every employer already has an open campaign or a live agreement."}
              </span>
            )}
          </div>
        </div>
      )}

      {activeAgreementEmployers.length > 0 && (
        <div className="rounded-xl border border-card-border bg-card p-5">
          <h3 className="text-heading-sm font-semibold text-foreground">
            Active collective agreements
          </h3>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {activeAgreementEmployers.map((employer) => (
              <div
                key={employer.corporationId}
                className="rounded-lg bg-card-elevated px-3 py-3 text-body"
              >
                <Link
                  href={`/corporation/${employer.corporationId}`}
                  className="font-medium text-primary hover:underline"
                >
                  {employer.corporationName}
                </Link>
                <p className="mt-1 text-body-sm text-muted">
                  {(employer.agreementWageLevel ?? employer.averageWageLevel).toFixed(2)}× wage
                  floor · Expires turn {employer.agreementExpiresAtTurn} · Labour peace through turn{" "}
                  {employer.agreementNoStrikeUntilTurn ?? "complete"}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {campaigns.length === 0 ? (
        <div className="rounded-xl border border-card-border bg-card p-6">
          <EmptyState
            title="No bargaining history"
            description="No collective-bargaining campaign has been opened with an employer yet."
          />
        </div>
      ) : (
        campaigns.map((campaign) => {
          const offer = campaign.currentOffer;
          const counter = counterDrafts[campaign.campaignId] ?? offer;
          const canAccept =
            isLeader &&
            (campaign.status === "negotiating" || campaign.status === "dispute") &&
            offer.proposedBy === "employer";
          const canCounter =
            isLeader &&
            (campaign.status === "negotiating" || campaign.status === "dispute") &&
            offer.proposedBy === "employer";
          const nextEscalation = nextEscalationFor(campaign.escalationLevel);
          const escalationPreview = campaign.escalationPreview;
          const escalationSupport = escalationPreview?.supportRequired ?? null;
          const canEscalate =
            isLeader &&
            campaign.status === "dispute" &&
            nextEscalation != null &&
            escalationSupport != null &&
            campaign.mandate.support >= escalationSupport &&
            campaign.lastActionTurn < currentTurn &&
            unionTreasury >= (escalationPreview?.cashCost ?? 0) &&
            !escalationPreview?.blockedReason &&
            (escalationPreview?.targetLocals.length ?? 0) > 0;
          const mediation = campaign.mediation;
          // Both figures come from the server, which scopes them to the locals
          // that still resolve, exactly as the turn charges them. The panel used
          // to recompute these from `sectorCount` against a mirrored constant,
          // which overstated the cost for a campaign whose locals had since been
          // sold or destroyed.
          const heldUpkeep = campaign.heldUpkeepPerTurn ?? 0;
          const nextUpkeep = campaign.escalationPreview?.upkeepPerTurn ?? 0;
          const turnsFunded = heldUpkeep > 0 ? Math.floor(unionTreasury / heldUpkeep) : null;
          // First reason the escalate command would refuse, in the order a
          // leader can act on it. Printed as visible text, not a tooltip.
          const escalateBlocker =
            escalationSupport != null && campaign.mandate.support < escalationSupport
              ? `Requires ${escalationSupport} member support. This campaign has ${campaign.mandate.support.toFixed(0)}.`
              : campaign.lastActionTurn >= currentTurn
                ? "This campaign has already acted this turn."
                : unionTreasury < (escalationPreview?.cashCost ?? 0)
                  ? `Needs ${(escalationPreview?.cashCost ?? 0).toLocaleString("en-US")} in the treasury.`
                  : (escalationPreview?.blockedReason ??
                    ((escalationPreview?.targetLocals.length ?? 0) === 0
                      ? "No local is available to escalate against right now."
                      : null));
          // A long member state list wraps into a wall of codes on mobile, so
          // it is capped and counted instead.
          const targetStateIds = (escalationPreview?.targetLocals ?? []).map(
            (local) => local.stateId
          );
          const targetStates =
            targetStateIds.length > 6
              ? `${targetStateIds.slice(0, 6).join(", ")} and ${targetStateIds.length - 6} more`
              : targetStateIds.join(", ");
          return (
            <article
              key={campaign.campaignId}
              className="rounded-xl border border-card-border bg-card p-5 space-y-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <Link
                    href={`/corporation/${campaign.employerCorporationId}`}
                    className="font-semibold text-primary hover:underline"
                  >
                    {campaign.employerName}
                  </Link>
                  <p className="text-body-sm text-muted">
                    {campaign.sectorCount} local(s) · Deadline turn {campaign.deadlineTurn} ·{" "}
                    {campaign.offers.length} offer(s)
                  </p>
                </div>
                <CampaignStatus campaign={campaign} />
              </div>

              {/* Six metrics: three across at sm so the row never leaves one
                  orphan, six across once there is width for it. */}
              <div className="grid grid-cols-2 gap-3 text-body sm:grid-cols-3 lg:grid-cols-6">
                <Metric label="Wage floor" value={`${offer.wageLevel.toFixed(2)}×`} />
                <Metric label="Agreement" value={`${offer.agreementDurationTurns} turns`} />
                <Metric label="Labour peace" value={`${offer.noStrikeTurns} turns`} />
                <Metric
                  label="Pension"
                  value={
                    offer.pensionContributionRate
                      ? `${(offer.pensionContributionRate * 100).toFixed(1)}% of pay`
                      : "None"
                  }
                />
                <Metric label="Support" value={campaign.mandate.support.toFixed(0)} />
                <Metric label="Leverage" value={campaign.mandate.leverage.toFixed(0)} />
              </div>

              <MandateBreakdown mandate={campaign.mandate} />

              {campaign.offers.length > 1 && <OfferHistory offers={campaign.offers} />}

              {campaign.status === "dispute" && (
                <div className="rounded-lg border border-warning/30 bg-warning/5 p-3 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-body font-semibold text-foreground">Industrial action</p>
                      <p className="text-body-sm text-muted">
                        Current level: {campaign.escalationLevel.replaceAll("_", " ")}
                      </p>
                      {heldUpkeep > 0 && (
                        <p className="text-body-sm text-warning">
                          Upkeep {heldUpkeep.toLocaleString("en-US")} per turn · treasury funds{" "}
                          {turnsFunded} more turn(s). The ban ends by itself when it cannot be paid.
                        </p>
                      )}
                    </div>
                    {isLeader && nextEscalation && (
                      <Button
                        variant="destructive"
                        size="sm"
                        disabled={pending || !canEscalate}
                        onClick={() => confirmEscalation(campaign)}
                      >
                        {nextEscalation.label}
                      </Button>
                    )}
                  </div>

                  {/* A `title` never fires on a disabled button and never fires
                      on touch at all, so every reason the escalation is refused
                      is printed here instead. */}
                  {isLeader && nextEscalation && !canEscalate && escalateBlocker && (
                    <p className="flex items-start gap-2 text-body-sm font-medium text-error">
                      <span aria-hidden>⚠</span>
                      <span>{escalateBlocker}</span>
                    </p>
                  )}

                  {nextEscalation && escalationPreview && (
                    <p className="text-body-sm text-muted">
                      Cost {escalationPreview.cashCost.toLocaleString("en-US")} · Affects{" "}
                      {escalationPreview.targetLocals.length} local(s)
                      {targetStates ? `: ${targetStates}` : ""}
                      {escalationPreview.newStrikeLocalCount > 0
                        ? ` · ${escalationPreview.newStrikeLocalCount} new strike call(s)`
                        : ""}
                      {nextUpkeep > 0
                        ? ` · then ${nextUpkeep.toLocaleString("en-US")} per turn to hold it`
                        : ""}
                    </p>
                  )}

                  {mediation ? (
                    <div className="rounded-lg bg-card p-3 text-body">
                      <p className="font-medium text-foreground">
                        Mediation package: {mediation.wageLevel.toFixed(2)}× wage,{" "}
                        {mediation.agreementDurationTurns} turns, {mediation.noStrikeTurns}{" "}
                        no-strike
                      </p>
                      <p className="mt-1 text-body-sm text-muted">
                        {mediation.status === "pending"
                          ? `Open through turn ${mediation.expiresAtTurn}. Union ${mediation.unionAccepted ? "accepted" : "pending"}; employer ${mediation.employerAccepted ? "accepted" : "pending"}.`
                          : `Mediation ${mediation.status}.`}
                      </p>
                      {isLeader && mediation.status === "pending" && !mediation.unionAccepted && (
                        <div className="mt-3 flex gap-2">
                          <Button
                            size="sm"
                            className="bg-success hover:bg-success-muted"
                            disabled={pending}
                            onClick={() => void act(campaign.campaignId, "accept_mediation")}
                          >
                            Accept mediation
                          </Button>
                          <Button
                            variant="secondary"
                            size="sm"
                            className="border-error/40 text-error hover:border-error/60 hover:text-error"
                            disabled={pending}
                            onClick={() => void act(campaign.campaignId, "reject_mediation")}
                          >
                            Reject mediation
                          </Button>
                        </div>
                      )}
                    </div>
                  ) : isLeader && campaign.mediationAvailable ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      className="border-primary/40 text-primary hover:border-primary/60 hover:text-primary"
                      disabled={pending}
                      onClick={() => void act(campaign.campaignId, "request_mediation")}
                    >
                      Request mediation
                    </Button>
                  ) : campaign.mediationUnavailableReason ? (
                    <p className="text-body-sm text-muted">{campaign.mediationUnavailableReason}</p>
                  ) : null}
                </div>
              )}

              {campaign.ratification && (
                <RatificationCard
                  ratification={campaign.ratification}
                  currentTurn={currentTurn}
                  pending={pending}
                  onVote={(vote) => void castBallot(campaign.campaignId, vote)}
                />
              )}

              {canAccept && (
                <div className="space-y-3 border-t border-card-border pt-4">
                  {canCounter && (
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                      <NumberField
                        label="Counter wage"
                        value={String(counter.wageLevel)}
                        step="0.01"
                        min="0.8"
                        max="1.5"
                        onChange={(value) =>
                          setCounterDrafts((all) => ({
                            ...all,
                            [campaign.campaignId]: { ...counter, wageLevel: Number(value) },
                          }))
                        }
                      />
                      <NumberField
                        label="Agreement turns"
                        value={String(counter.agreementDurationTurns)}
                        step="1"
                        min="24"
                        max="192"
                        onChange={(value) =>
                          setCounterDrafts((all) => ({
                            ...all,
                            [campaign.campaignId]: {
                              ...counter,
                              agreementDurationTurns: Number(value),
                            },
                          }))
                        }
                      />
                      <NumberField
                        label="No-strike turns"
                        value={String(counter.noStrikeTurns)}
                        step="1"
                        min="0"
                        max={String(counter.agreementDurationTurns)}
                        onChange={(value) =>
                          setCounterDrafts((all) => ({
                            ...all,
                            [campaign.campaignId]: { ...counter, noStrikeTurns: Number(value) },
                          }))
                        }
                      />
                      <NumberField
                        label="Pension %"
                        value={String(((counter.pensionContributionRate ?? 0) * 100).toFixed(1))}
                        step="0.5"
                        min="0"
                        max="15"
                        onChange={(value) =>
                          setCounterDrafts((all) => ({
                            ...all,
                            [campaign.campaignId]: {
                              ...counter,
                              pensionContributionRate: Number(value) / 100,
                            },
                          }))
                        }
                      />
                    </div>
                  )}
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      className="bg-success hover:bg-success-muted"
                      disabled={pending || !!campaign.ratificationBlockedReason}
                      title={campaign.ratificationBlockedReason ?? undefined}
                      onClick={() => void act(campaign.campaignId, "accept")}
                    >
                      Accept and put to members
                    </Button>
                    {canCounter && (
                      <Button
                        size="sm"
                        disabled={pending}
                        onClick={() => void act(campaign.campaignId, "counter")}
                      >
                        Send counteroffer
                      </Button>
                    )}
                  </div>
                  <p className="text-body-sm text-muted">
                    Accepting does not settle on its own. The offer goes to the organizers, who
                    ratify or reject it by banked strength.
                  </p>
                  {campaign.ratificationBlockedReason && (
                    <p className="text-body-sm font-medium text-error">
                      {campaign.ratificationBlockedReason}
                    </p>
                  )}
                </div>
              )}

              {isLeader && (campaign.status === "negotiating" || campaign.status === "dispute") && (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={pending}
                  onClick={() => void act(campaign.campaignId, "withdraw")}
                  className="hover:text-error"
                >
                  Withdraw campaign
                </Button>
              )}
            </article>
          );
        })
      )}
    </div>
  );
}

/**
 * The member ballot on a settlement. Every organizer sees the offer, the
 * running weighted tally and how much strength has not answered; an organizer
 * who holds a ballot also sees their own weight and can cast it. The president
 * reads the same card, because the state of the vote is the only thing they can
 * act on while it runs.
 */
function RatificationCard({
  ratification,
  currentTurn,
  pending,
  onVote,
}: {
  ratification: UnionRatificationView;
  currentTurn: number;
  pending: boolean;
  onVote: (vote: "ratify" | "reject") => void;
}) {
  const open = ratification.status === "open" && currentTurn < ratification.closesAtTurn;
  const share = (value: number) =>
    ratification.totalStrength > 0
      ? `${((value / ratification.totalStrength) * 100).toFixed(0)}%`
      : "0%";
  return (
    <div className="rounded-lg border border-info/30 bg-info/5 p-3 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-body font-semibold text-foreground">
            Member ratification of offer {ratification.offerRevision}
          </p>
          <p className="text-body-sm text-muted">
            {open
              ? `Open through turn ${ratification.closesAtTurn}. ${ratification.voterCount} organizer(s) hold a ballot.`
              : ratification.status === "ratified"
                ? `Ratified on turn ${ratification.closedAtTurn ?? ratification.closesAtTurn}.`
                : ratification.status === "rejected"
                  ? `Rejected on turn ${ratification.closedAtTurn ?? ratification.closesAtTurn}. The offer is still on the table; move the package or the campaign runs its course.`
                  : "Void: the campaign ended before the members answered."}
          </p>
        </div>
        <span className="rounded-full bg-card-elevated px-2.5 py-1 text-body-sm font-semibold text-muted">
          {ratification.status}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Metric
          label="Ratify"
          value={`${ratification.ratifyStrength.toFixed(0)} (${share(ratification.ratifyStrength)})`}
        />
        <Metric
          label="Reject"
          value={`${ratification.rejectStrength.toFixed(0)} (${share(ratification.rejectStrength)})`}
        />
        <Metric label="Not voted" value={ratification.outstandingStrength.toFixed(0)} />
        <Metric label="Your weight" value={ratification.viewerWeight.toFixed(0)} />
      </div>

      {ratification.viewerWeight > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            className="bg-success hover:bg-success-muted"
            disabled={pending || !open}
            onClick={() => onVote("ratify")}
          >
            Ratify
          </Button>
          <Button
            variant="secondary"
            size="sm"
            className="border-error/40 text-error hover:border-error/60 hover:text-error"
            disabled={pending || !open}
            onClick={() => onVote("reject")}
          >
            Reject
          </Button>
          <span className="text-body-sm text-muted">
            {ratification.viewerVote
              ? `You voted to ${ratification.viewerVote}.`
              : "You have not voted."}
          </span>
        </div>
      )}
      {ratification.viewerWeight === 0 && open && (
        <p className="text-body-sm text-muted">
          Only organizers holding strength when the vote opened can answer it.
        </p>
      )}
    </div>
  );
}

function CampaignStatus({ campaign }: { campaign: UnionBargainingCampaign }) {
  const offer = campaign.currentOffer;
  const style =
    campaign.status === "settled"
      ? "bg-success/15 text-success"
      : campaign.status === "dispute"
        ? "bg-error/15 text-error"
        : campaign.status === "withdrawn" || campaign.status === "lapsed"
          ? "bg-card-elevated text-muted"
          : "bg-warning/15 text-warning";
  return (
    <span className={`rounded-full px-2.5 py-1 text-body-sm font-semibold ${style}`}>
      {campaign.status === "negotiating"
        ? `Offer ${offer.revision} from ${offer.proposedBy}`
        : campaign.status === "lapsed"
          ? "lapsed (unresolved)"
          : campaign.status}
    </span>
  );
}

function OfferHistory({ offers }: { offers: UnionBargainingOffer[] }) {
  return (
    <details className="rounded-lg bg-card-elevated px-3 py-2 text-body">
      <summary className="cursor-pointer font-medium text-foreground">
        Offer history ({offers.length})
      </summary>
      <ol className="mt-2 space-y-1 text-body-sm text-muted">
        {offers.map((offer) => (
          <li key={offer.revision}>
            #{offer.revision} {offer.proposedBy}: {offer.wageLevel.toFixed(2)}× wage,{" "}
            {offer.agreementDurationTurns} turns, {offer.noStrikeTurns} no-strike
          </li>
        ))}
      </ol>
    </details>
  );
}

/**
 * The inputs behind support and leverage. The union sees all of them, strike
 * fund included: it is the leader's own treasury, and without it a mandate
 * that falls because the fund drained is indistinguishable from one that fell
 * because the law changed.
 */
function MandateBreakdown({ mandate }: { mandate: BargainingMandateView }) {
  return (
    <details className="rounded-lg bg-card-elevated px-3 py-2 text-body">
      <summary className="cursor-pointer font-medium text-foreground">
        What support and leverage are built from
      </summary>
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Metric label="Coverage" value={mandate.coverage.toFixed(0)} />
        <Metric label="Grievance" value={mandate.grievance.toFixed(0)} />
        <Metric label="Labour market" value={mandate.laborTightness.toFixed(0)} />
        <Metric label="Labour law" value={mandate.lawSupport.toFixed(0)} />
        <Metric label="Strike fund" value={`${mandate.strikeFundRunway.toFixed(1)} calls`} />
      </div>
      <p className="mt-2 text-body-sm text-muted">
        Recomputed every turn. Coverage is how organized the locals in scope are, grievance is the
        gap between pay and what members expect, labour market is national scarcity of workers,
        labour law is what collective bargaining is worth here, and the strike fund is how many
        strike calls the treasury can pay for.
      </p>
    </details>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-body-sm text-muted">{label}</div>
      <div className="font-mono font-semibold text-foreground">{value}</div>
    </div>
  );
}

function NumberField({
  label,
  value,
  step,
  min,
  max,
  onChange,
}: {
  label: string;
  value: string;
  step: string;
  min: string;
  max: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="text-body-sm text-muted">
      {label}
      <input
        type="number"
        value={value}
        step={step}
        min={min}
        max={max}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 w-full rounded-lg border border-card-border bg-background px-3 py-2 text-body text-foreground"
      />
    </label>
  );
}
