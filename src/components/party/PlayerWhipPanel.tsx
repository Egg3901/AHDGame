"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useToast } from "@/contexts/ToastContext";
import { getCountryConfig, type CountryId } from "@/lib/constants/countries";
import { partyApiUrl, legislatureUrl } from "@/lib/urls";
import { fetchJson } from "@/lib/observability/fetchJson";
import { WhipTabsLayout } from "./whipTabsLayout";
import type { PlayerWhipIssuerRole } from "@/lib/partyWhips/playerWhipSummary";
import type { PlayerWhipMode } from "@/lib/db/types";
import type { WhipEndpointConfig } from "./WhipTabs";

interface PlayerWhipEntry {
  direction: string;
  attemptNumber: number;
  createdAt: string;
  issuerRole: PlayerWhipIssuerRole;
  mode: PlayerWhipMode;
  candidacyId?: string;
}

interface BillWhipItem {
  bill: { id: string; title: string; status: string };
  playerWhip: {
    existingWhips: PlayerWhipEntry[];
    canWhip: boolean;
  };
}

interface CandidacyInfo {
  id: string;
  nomineeName: string;
  nomineeParty?: string;
}

interface LeadershipElectionItem {
  id: string;
  type?: string;
  candidacies: CandidacyInfo[];
  playerWhip: {
    existingWhips: PlayerWhipEntry[];
    canWhip: boolean;
  };
}

interface PlayerWhipPanelProps {
  partyId: string;
  partyColor: string;
  countryId: string;
  /** Eligible states for national state-legislature whips (national only). */
  eligibleStates?: Array<{ id: string; name: string }>;
  endpointConfig?: WhipEndpointConfig;
}

/**
 * Player Whip panel (national-party only). One-shot whip per (target, chamber)
 * that force-overwrites seated characters' votes in that chamber to the whip
 * direction, preserves the pre-whip value in whippedFromVote, and sends mail +
 * notification to each affected character.
 */
export function PlayerWhipPanel({
  partyId,
  partyColor,
  countryId,
  endpointConfig,
}: PlayerWhipPanelProps) {
  const { showToast } = useToast();
  const effectiveCountryId = countryId.toLowerCase();
  const resolvedCountryId = countryId.toUpperCase() as CountryId;
  const billsUrl =
    endpointConfig?.billsUrl ?? `${partyApiUrl(effectiveCountryId, partyId)}/whippable-bills`;
  const leadershipUrl =
    endpointConfig?.leadershipUrl ??
    `${partyApiUrl(effectiveCountryId, partyId)}/whippable-leadership`;
  const whipUrl = endpointConfig?.whipUrl ?? `${partyApiUrl(effectiveCountryId, partyId)}/whip`;

  const [whippingId, setWhippingId] = useState<string | null>(null);
  const [whipMode, setWhipMode] = useState<PlayerWhipMode>("soft");
  const [refreshKey, setRefreshKey] = useState(0);

  const [billsByChamber, setBillsByChamber] = useState<Record<string, BillWhipItem[]>>({});
  const [leadershipItems, setLeadershipItems] = useState<LeadershipElectionItem[]>([]);
  const [cabinetItems, setCabinetItems] = useState<LeadershipElectionItem[]>([]);

  const preferredBillChamberKey = useMemo(() => {
    const config = getCountryConfig(resolvedCountryId);
    const chamberKeys = [
      ...(config.upperElectionSystem && config.legislature.upperChamber
        ? [config.legislature.upperChamber.key]
        : []),
      config.legislature.lowerChamber.key,
    ];
    return (
      chamberKeys.find((key) => (billsByChamber[key] ?? []).length > 0) ?? chamberKeys[0] ?? "house"
    );
  }, [billsByChamber, resolvedCountryId]);

  useEffect(() => {
    let cancelled = false;
    fetch(billsUrl)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("Failed"))))
      .then((data) => {
        if (cancelled) return;
        setBillsByChamber(data);
      })
      .catch(() => showToast("Failed to load whippable bills", "error"));
    return () => {
      cancelled = true;
    };
  }, [billsUrl, refreshKey, showToast]);

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    fetchJson<any>(leadershipUrl, { feature: "player-whip-leadership" })
      .then((data) => {
        if (cancelled) return;
        const all = Object.values(data).flat() as LeadershipElectionItem[];
        setLeadershipItems(all.filter((e) => !e.type?.startsWith("Cabinet:")));
        setCabinetItems(all.filter((e) => e.type?.startsWith("Cabinet:")));
      })
      .catch(() => {
        /* non-fatal */
      });
    return () => {
      cancelled = true;
    };
  }, [leadershipUrl, refreshKey]);

  const postWhip = async (
    body: Record<string, unknown>,
    busyId: string,
    successPrefix?: string
  ) => {
    setWhippingId(busyId);
    try {
      const res = await fetch(whipUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ audience: "character", ...body }),
      });
      const data = await res.json();
      if (res.ok) {
        showToast(successPrefix ? `${successPrefix} ${data.message}` : data.message, "success");
        setRefreshKey((k) => k + 1);
      } else {
        showToast(data.error || "Failed to issue whip", "error");
      }
    } catch {
      showToast("Network error", "error");
    } finally {
      setWhippingId(null);
    }
  };

  const handleBillWhip = (
    billId: string,
    billTitle: string,
    chamberKey: string,
    direction: "for" | "against"
  ) => {
    postWhip(
      { targetType: "bill", targetId: billId, chamber: chamberKey, direction, mode: whipMode },
      billId,
      `${whipMode === "soft" ? "Soft" : "Hard"} Player Whip issued on "${billTitle}".`
    );
  };

  const handleLeadershipCandidacyWhip = (election: LeadershipElectionItem, candidacyId: string) => {
    const config = getCountryConfig(resolvedCountryId);
    const targetType = election.type === "speaker" ? "speakerElection" : "leadershipElection";
    const isLower =
      election.type === "speaker" ||
      election.type === "majority_leader" ||
      election.type === "minority_leader";
    const chamber = isLower
      ? config.legislature.lowerChamber.key
      : config.upperElectionSystem
        ? (config.legislature.upperChamber?.key ?? config.legislature.lowerChamber.key)
        : config.legislature.lowerChamber.key;
    postWhip(
      {
        targetType,
        targetId: election.id,
        chamber,
        direction: "for",
        candidacyId,
        mode: whipMode,
      },
      `${election.id}_${candidacyId}`
    );
  };

  const handleGovernmentVoteWhip = (
    voteId: string,
    direction: "for" | "against",
    targetType: "pmAppointmentVote" | "noConfidenceVote"
  ) => {
    const config = getCountryConfig(resolvedCountryId);
    postWhip(
      {
        targetType,
        targetId: voteId,
        chamber: config.legislature.lowerChamber.key,
        direction,
        mode: whipMode,
      },
      `cv_${voteId}_${direction}`
    );
  };

  const handleCabinetWhip = (nominationId: string, direction: "for" | "against") => {
    const config = getCountryConfig(resolvedCountryId);
    const chamber = config.upperElectionSystem
      ? (config.legislature.upperChamber?.key ?? config.legislature.lowerChamber.key)
      : config.legislature.lowerChamber.key;
    postWhip(
      {
        targetType: "cabinetNomination",
        targetId: nominationId,
        chamber,
        direction,
        mode: whipMode,
      },
      `cab_${nominationId}_${direction}`
    );
  };

  const formatIssuedAt = (value: string) =>
    new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(value));

  const getIssuerLabel = (role: PlayerWhipIssuerRole) => {
    switch (role) {
      case "chair":
        return "Chair";
      case "viceChair":
        return "Vice Chair";
      default:
        return "Admin";
    }
  };

  const getModeLabel = (mode: PlayerWhipMode) => (mode === "soft" ? "Soft" : "Hard");

  const hasModeWhip = (existingWhips: PlayerWhipEntry[]) =>
    existingWhips.some((whip) => whip.mode === whipMode);

  const getPlayerWhipDisabledTitle = (existingWhips: PlayerWhipEntry[]) =>
    hasModeWhip(existingWhips)
      ? `${getModeLabel(whipMode)} Player Whips can only be used one time per target.`
      : undefined;

  const renderPlayerWhipMetadata = (
    existingWhips: PlayerWhipEntry[],
    candidacies?: CandidacyInfo[]
  ) =>
    existingWhips.map((whip, index) => {
      const candidateName = whip.candidacyId
        ? (candidacies?.find((candidate) => candidate.id === whip.candidacyId)?.nomineeName ?? null)
        : null;
      const directionLabel =
        candidateName || !whip.direction ? null : `Vote ${whip.direction.toUpperCase()}`;
      const candidateLabel = candidateName ? `Support ${candidateName}` : null;
      const summaryBits = [
        `${getModeLabel(whip.mode)} whip`,
        directionLabel,
        candidateLabel,
        formatIssuedAt(whip.createdAt),
        getIssuerLabel(whip.issuerRole),
      ].filter((value): value is string => Boolean(value));
      return (
        <div
          key={`${whip.attemptNumber}-${whip.createdAt}-${index}`}
          className="text-xs text-muted"
        >
          <span className="text-primary font-medium">Player Whip issued</span>
          {summaryBits.length > 0 ? ` - ${summaryBits.join(" - ")}` : ""}
        </div>
      );
    });

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-card-border bg-card px-4 py-3">
        <p className="text-sm text-muted">
          Soft Player Whips send an in-game suggestion only. Hard Player Whips immediately overwrite
          eligible player votes until those players change their votes manually. Each bill or vote
          target can receive one Soft Player Whip and one Hard Player Whip.
        </p>
      </div>
      <div
        role="tablist"
        className="flex gap-1 p-1 rounded-lg bg-background border border-card-border w-fit"
      >
        {(["soft", "hard"] as const).map((mode) => (
          <button
            key={mode}
            role="tab"
            aria-selected={whipMode === mode}
            onClick={() => setWhipMode(mode)}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
              whipMode === mode
                ? "bg-card text-foreground shadow-sm"
                : "text-muted hover:text-foreground"
            }`}
          >
            {mode === "soft" ? "Soft" : "Hard"}
          </button>
        ))}
      </div>
      <WhipTabsLayout
        countryId={effectiveCountryId}
        isNational={true}
        includeSubNationalChamber={false}
        preferredBillChamberKey={preferredBillChamberKey}
        renderBills={(chamberKey) => {
          const bills = billsByChamber[chamberKey] ?? [];

          return (
            <div className="space-y-3">
              {bills.length === 0 ? (
                <p className="text-sm text-muted italic">
                  No active bills to Player-Whip in this chamber.
                </p>
              ) : (
                bills.map((item) => (
                  <div
                    key={item.bill.id}
                    className="rounded-lg border border-card-border bg-card p-4"
                  >
                    {(() => {
                      const modeAlreadyUsed = hasModeWhip(item.playerWhip.existingWhips);
                      const disabledTitle = getPlayerWhipDisabledTitle(
                        item.playerWhip.existingWhips
                      );
                      return (
                        <>
                          <div className="flex items-start justify-between gap-4">
                            <div>
                              <h4 className="font-medium text-sm">
                                <Link
                                  href={`${legislatureUrl(effectiveCountryId)}?highlight=${item.bill.id}`}
                                  className="hover:text-primary transition-colors"
                                >
                                  {item.bill.title}
                                </Link>
                              </h4>
                              <div className="flex items-center gap-2 mt-1">
                                <span className="text-xs text-muted capitalize">
                                  {item.bill.status}
                                </span>
                              </div>
                              {item.playerWhip.existingWhips.length > 0 &&
                                renderPlayerWhipMetadata(item.playerWhip.existingWhips)}
                            </div>
                            <div className="flex gap-2 shrink-0">
                              <button
                                onClick={() =>
                                  handleBillWhip(item.bill.id, item.bill.title, chamberKey, "for")
                                }
                                disabled={modeAlreadyUsed || whippingId === item.bill.id}
                                title={disabledTitle}
                                className="px-3 py-1.5 text-xs font-medium rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                style={{
                                  backgroundColor: !modeAlreadyUsed ? `${partyColor}20` : undefined,
                                  color: !modeAlreadyUsed ? partyColor : undefined,
                                }}
                              >
                                {whippingId === item.bill.id ? "Issuing..." : "Whip FOR"}
                              </button>
                              <button
                                onClick={() =>
                                  handleBillWhip(
                                    item.bill.id,
                                    item.bill.title,
                                    chamberKey,
                                    "against"
                                  )
                                }
                                disabled={modeAlreadyUsed || whippingId === item.bill.id}
                                title={disabledTitle}
                                className="px-3 py-1.5 text-xs font-medium rounded-md border border-card-border bg-card hover:bg-muted/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                              >
                                {whippingId === item.bill.id ? "Issuing..." : "Whip AGAINST"}
                              </button>
                            </div>
                          </div>
                        </>
                      );
                    })()}
                  </div>
                ))
              )}
            </div>
          );
        }}
        renderLeadership={() => {
          if (leadershipItems.length === 0) {
            return <p className="text-sm text-muted italic">No active leadership elections.</p>;
          }
          return (
            <div className="space-y-3">
              {leadershipItems.map((election) => {
                const whip = election.playerWhip;
                const modeAlreadyUsed = hasModeWhip(whip.existingWhips);
                const disabledTitle = getPlayerWhipDisabledTitle(whip.existingWhips);
                const isPM =
                  election.type === "pmAppointmentVote" ||
                  election.type === "PM Appointment Vote" ||
                  election.type === "Minority Government Attempt";
                const isNC =
                  election.type === "noConfidenceVote" ||
                  election.type === "No-Confidence Motion" ||
                  election.type === "PM Confidence Vote";
                const nominee = election.candidacies[0];
                const headerLabel = isPM
                  ? `PM Appointment — ${nominee?.nomineeName ?? "(unknown nominee)"}`
                  : isNC
                    ? (nominee?.nomineeName ?? "No-Confidence Motion")
                    : (election.type?.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) ??
                      "Leadership Election");

                return (
                  <div
                    key={election.id}
                    className="rounded-lg border border-card-border bg-card p-4"
                  >
                    <h4 className="font-medium text-sm mb-3">{headerLabel}</h4>
                    {whip.existingWhips.length > 0 && (
                      <div className="mb-2">
                        {renderPlayerWhipMetadata(whip.existingWhips, election.candidacies)}
                      </div>
                    )}
                    {isPM ? (
                      <div className="flex flex-wrap gap-2">
                        <button
                          onClick={() =>
                            handleGovernmentVoteWhip(election.id, "for", "pmAppointmentVote")
                          }
                          disabled={modeAlreadyUsed || whippingId === `cv_${election.id}_for`}
                          title={disabledTitle}
                          className="px-3 py-1.5 text-xs font-medium rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                          style={{
                            backgroundColor: !modeAlreadyUsed ? `${partyColor}20` : undefined,
                            color: !modeAlreadyUsed ? partyColor : undefined,
                          }}
                        >
                          {whippingId === `cv_${election.id}_for` ? "Issuing..." : "Whip FOR"}
                        </button>
                        <button
                          onClick={() =>
                            handleGovernmentVoteWhip(election.id, "against", "pmAppointmentVote")
                          }
                          disabled={modeAlreadyUsed || whippingId === `cv_${election.id}_against`}
                          title={disabledTitle}
                          className="px-3 py-1.5 text-xs font-medium rounded-md border border-card-border bg-card hover:bg-muted/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {whippingId === `cv_${election.id}_against`
                            ? "Issuing..."
                            : "Whip AGAINST"}
                        </button>
                      </div>
                    ) : isNC ? (
                      <div className="flex flex-wrap gap-2">
                        <button
                          onClick={() =>
                            handleGovernmentVoteWhip(election.id, "for", "noConfidenceVote")
                          }
                          disabled={modeAlreadyUsed || whippingId === `cv_${election.id}_for`}
                          title={disabledTitle}
                          className="px-3 py-1.5 text-xs font-medium rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                          style={{
                            backgroundColor: !modeAlreadyUsed ? `${partyColor}20` : undefined,
                            color: !modeAlreadyUsed ? partyColor : undefined,
                          }}
                        >
                          {whippingId === `cv_${election.id}_for`
                            ? "Issuing..."
                            : "Whip FOR (Remove PM)"}
                        </button>
                        <button
                          onClick={() =>
                            handleGovernmentVoteWhip(election.id, "against", "noConfidenceVote")
                          }
                          disabled={modeAlreadyUsed || whippingId === `cv_${election.id}_against`}
                          title={disabledTitle}
                          className="px-3 py-1.5 text-xs font-medium rounded-md border border-card-border bg-card hover:bg-muted/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {whippingId === `cv_${election.id}_against`
                            ? "Issuing..."
                            : "Whip AGAINST (Keep PM)"}
                        </button>
                      </div>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        {election.candidacies.map((candidate) => {
                          const whipKey = `${election.id}_${candidate.id}`;
                          const isWhipped = whip.existingWhips.some(
                            (w) => w.candidacyId === candidate.id
                          );
                          return (
                            <button
                              key={candidate.id}
                              onClick={() => handleLeadershipCandidacyWhip(election, candidate.id)}
                              disabled={modeAlreadyUsed || isWhipped || whippingId === whipKey}
                              title={
                                modeAlreadyUsed
                                  ? disabledTitle
                                  : isWhipped
                                    ? "Already whipped for this candidate"
                                    : undefined
                              }
                              className="px-3 py-1.5 text-xs font-medium rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                              style={{
                                backgroundColor:
                                  !modeAlreadyUsed && !isWhipped ? `${partyColor}20` : undefined,
                                color: !modeAlreadyUsed && !isWhipped ? partyColor : undefined,
                              }}
                            >
                              {whippingId === whipKey
                                ? "Issuing..."
                                : isWhipped
                                  ? `${candidate.nomineeName} (whipped)`
                                  : `Whip for ${candidate.nomineeName}`}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          );
        }}
        renderCabinet={() => {
          if (cabinetItems.length === 0) {
            return (
              <p className="text-sm text-muted italic">No active cabinet nominations to whip.</p>
            );
          }
          return (
            <div className="space-y-3">
              {cabinetItems.map((item) => {
                const whip = item.playerWhip;
                const modeAlreadyUsed = hasModeWhip(whip.existingWhips);
                const disabledTitle = getPlayerWhipDisabledTitle(whip.existingWhips);
                return (
                  <div key={item.id} className="rounded-lg border border-card-border bg-card p-4">
                    <h4 className="font-medium text-sm mb-3">
                      <Link
                        href={`/congress/nominations/${item.id}`}
                        className="hover:text-primary transition-colors"
                      >
                        {item.type ?? "Cabinet Nomination"}
                      </Link>
                    </h4>
                    {whip.existingWhips.length > 0 && (
                      <div className="mb-2">{renderPlayerWhipMetadata(whip.existingWhips)}</div>
                    )}
                    <div className="flex flex-wrap gap-2">
                      <button
                        onClick={() => handleCabinetWhip(item.id, "for")}
                        disabled={modeAlreadyUsed || whippingId === `cab_${item.id}_for`}
                        title={disabledTitle}
                        className="px-3 py-1.5 text-xs font-medium rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        style={{
                          backgroundColor: !modeAlreadyUsed ? `${partyColor}20` : undefined,
                          color: !modeAlreadyUsed ? partyColor : undefined,
                        }}
                      >
                        {whippingId === `cab_${item.id}_for` ? "Issuing..." : "Whip FOR"}
                      </button>
                      <button
                        onClick={() => handleCabinetWhip(item.id, "against")}
                        disabled={modeAlreadyUsed || whippingId === `cab_${item.id}_against`}
                        title={disabledTitle}
                        className="px-3 py-1.5 text-xs font-medium rounded-md border border-card-border bg-card hover:bg-muted/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {whippingId === `cab_${item.id}_against` ? "Issuing..." : "Whip AGAINST"}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          );
        }}
      />
    </div>
  );
}
