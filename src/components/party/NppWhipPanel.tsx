"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useToast } from "@/contexts/ToastContext";
import {
  COUNTRY_CONFIGS,
  getCountryConfig,
  getSubNationalLegislatureKey,
  type CountryId,
} from "@/lib/constants/countries";
import type { PlayerWhipMode } from "@/lib/db/types";
import { regionApiSubUrl, partyApiUrl, legislatureUrl } from "@/lib/urls";
import { fetchJson } from "@/lib/observability/fetchJson";
import { WhipTabsLayout } from "./whipTabsLayout";
import type { WhipEndpointConfig } from "./WhipTabs";

interface BillWhipItem {
  bill: { id: string; title: string; status: string };
  nppWhip?: {
    existingWhips: Array<{
      direction: string;
      attemptNumber: number;
      issuedByRole?: string;
      mode?: "soft" | "hard";
    }>;
    canWhip: boolean;
  };
  // Back-compat aliases (mirror nppWhip.*)
  existingWhips: Array<{
    direction: string;
    attemptNumber: number;
    issuedByRole?: string;
    mode?: "soft" | "hard";
  }>;
  canWhip: boolean;
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
  nppWhip?: {
    existingWhips: Array<{ candidacyId?: string; attemptNumber: number }>;
    canWhip: boolean;
  };
  // Back-compat aliases
  existingWhips: Array<{ candidacyId?: string; attemptNumber: number }>;
  canWhip: boolean;
}

function isCabinetWhipItem(item: LeadershipElectionItem): boolean {
  return item.type?.startsWith("Cabinet:") ?? false;
}

function isSupportedNppLeadershipItem(item: LeadershipElectionItem): boolean {
  // Cabinet nominations render on their own tab; everything else with a
  // leadership-style ballot (Speaker / chamber leaders / PM / confidence)
  // belongs on the Leadership tab — including US congress races so NPP hard
  // whips can move seat-weighted votes again (ticket #1053).
  return !isCabinetWhipItem(item);
}

interface NppWhipPanelProps {
  // For state party
  stateId?: string;
  // For both
  partyId: string;
  partyColor: string;
  isNational: boolean;
  // Country ID for national party API calls (e.g. "US", "UK")
  countryId?: string;
  // For national state legislature — list of eligible states
  eligibleStates?: Array<{ id: string; name: string }>;
  endpointConfig?: WhipEndpointConfig;
}

/**
 * NPP whip panel. Same mechanic as before (2 attempts per target/chamber;
 * hard whips immediately try to force NPP votes via the hidden
 * loyalty/stubbornness roll, while soft bill whips feed advisory pressure into
 * autonomous voting). UI reshaped into Bills / Leadership / Cabinet sub-sub-tabs
 * via WhipTabsLayout so the structure mirrors the sibling Player Whip panel.
 */
export function NppWhipPanel({
  stateId,
  partyId,
  partyColor,
  isNational,
  countryId,
  eligibleStates,
  endpointConfig,
}: NppWhipPanelProps) {
  const { showToast } = useToast();
  const resolvedCountryId = (countryId ?? COUNTRY_CONFIGS.US.id).toUpperCase() as CountryId;
  const effectiveCountryId = resolvedCountryId.toLowerCase();
  const subNationalChamberKey = getSubNationalLegislatureKey(resolvedCountryId);
  const billsUrl =
    endpointConfig?.billsUrl ?? `${partyApiUrl(effectiveCountryId, partyId)}/whippable-bills`;
  const leadershipUrl =
    endpointConfig?.leadershipUrl ??
    `${partyApiUrl(effectiveCountryId, partyId)}/whippable-leadership`;
  const whipUrl = endpointConfig?.whipUrl ?? `${partyApiUrl(effectiveCountryId, partyId)}/whip`;

  const [selectedState, setSelectedState] = useState("");
  const [whippingId, setWhippingId] = useState<string | null>(null);
  const [whipMode, setWhipMode] = useState<PlayerWhipMode>("hard");
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
      ...(config.subNationalChamber
        ? [isNational ? "stateLegislature" : config.subNationalChamber.key]
        : []),
    ];
    return (
      chamberKeys.find((key) => (billsByChamber[key] ?? []).length > 0) ?? chamberKeys[0] ?? "house"
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [billsByChamber, eligibleStates, isNational, resolvedCountryId]);

  // Fetch bills whenever the owning party / chamber / state changes
  useEffect(() => {
    let cancelled = false;

    const billsUrlForContext = endpointConfig?.billsUrl
      ? endpointConfig.billsUrl
      : isNational
        ? billsUrl
        : stateId
          ? regionApiSubUrl(effectiveCountryId, stateId, `party/${partyId}/whippable-bills`)
          : null;

    if (!billsUrlForContext) {
      setBillsByChamber({});
      return;
    }

    fetch(billsUrlForContext)
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          throw new Error(body?.error ?? `Failed to load bills (${res.status})`);
        }
        return res.json();
      })
      .then((data) => {
        if (cancelled) return;
        setBillsByChamber(data);
      })
      .catch((err: Error) => {
        if (!cancelled) showToast(err.message || "Failed to load bills", "error");
      });

    return () => {
      cancelled = true;
    };
  }, [
    isNational,
    effectiveCountryId,
    endpointConfig?.billsUrl,
    billsUrl,
    partyId,
    stateId,
    refreshKey,
    showToast,
  ]);

  // Fetch bills for the selected state (national + state legislature tab only)
  useEffect(() => {
    if (!isNational || !selectedState) return;
    let cancelled = false;

    const url = endpointConfig?.stateBillsUrlTemplate
      ? endpointConfig.stateBillsUrlTemplate.replace("{stateId}", encodeURIComponent(selectedState))
      : regionApiSubUrl(effectiveCountryId, selectedState, `party/${partyId}/whippable-bills`);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    fetchJson<any>(url, { feature: "npp-whip-state-bills" })
      .then((data) => {
        if (cancelled) return;
        setBillsByChamber((prev) => ({
          ...prev,
          stateLegislature: data[subNationalChamberKey] ?? [],
        }));
      })
      .catch(() => {
        // non-fatal; state-legislature tab stays empty
      });

    return () => {
      cancelled = true;
    };
  }, [
    isNational,
    effectiveCountryId,
    endpointConfig?.stateBillsUrlTemplate,
    selectedState,
    partyId,
    refreshKey,
    subNationalChamberKey,
  ]);

  // Fetch leadership and cabinet items
  useEffect(() => {
    let cancelled = false;

    const url = endpointConfig?.leadershipUrl
      ? endpointConfig.leadershipUrl
      : isNational
        ? leadershipUrl
        : stateId
          ? regionApiSubUrl(effectiveCountryId, stateId, `party/${partyId}/whippable-leadership`)
          : null;
    if (!url) return;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    fetchJson<any>(url, { feature: "npp-whip-leadership" })
      .then((data) => {
        if (cancelled) return;
        // National returns Record<chamberKey, items[]>; flatten.
        // State returns { speakerElections, leadershipElections } — also flatten.
        const all: LeadershipElectionItem[] = isNational
          ? (Object.values(data).flat() as LeadershipElectionItem[])
          : [
              ...((data.speakerElections ?? []) as LeadershipElectionItem[]),
              ...((data.leadershipElections ?? []) as LeadershipElectionItem[]),
            ];
        setLeadershipItems(all.filter(isSupportedNppLeadershipItem));
        setCabinetItems(all.filter(isCabinetWhipItem));
      })
      .catch(() => {
        // leadership data is supplementary — fail silently
      });

    return () => {
      cancelled = true;
    };
  }, [
    isNational,
    effectiveCountryId,
    endpointConfig?.leadershipUrl,
    leadershipUrl,
    partyId,
    stateId,
    refreshKey,
    resolvedCountryId,
  ]);

  // Whip a bill for a given chamber
  const handleBillWhip = async (
    billId: string,
    chamberKey: string,
    direction: "for" | "against"
  ) => {
    setWhippingId(billId);
    try {
      const useNationalEndpoint = isNational && chamberKey !== "stateLegislature";
      const url = endpointConfig?.whipUrl
        ? endpointConfig.whipUrl
        : useNationalEndpoint
          ? whipUrl
          : regionApiSubUrl(
              effectiveCountryId,
              chamberKey === "stateLegislature" && isNational ? selectedState! : stateId!,
              `party/${partyId}/whip`
            );
      const chamber = chamberKey === "stateLegislature" ? subNationalChamberKey : chamberKey;

      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          audience: "npp",
          targetType: "bill",
          targetId: billId,
          chamber,
          direction,
          mode: whipMode,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        showToast(data.message, "success");
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

  const handleLeadershipCandidacyWhip = async (
    election: LeadershipElectionItem,
    candidacyId: string
  ) => {
    setWhippingId(`${election.id}_${candidacyId}`);
    try {
      const targetType = election.type === "speaker" ? "speakerElection" : "leadershipElection";
      const chamber =
        election.type === "speaker" ||
        election.type === "majority_leader" ||
        election.type === "minority_leader"
          ? getCountryConfig((countryId ?? "US").toUpperCase() as CountryId).legislature
              .lowerChamber.key
          : (getCountryConfig((countryId ?? "US").toUpperCase() as CountryId).legislature
              .upperChamber?.key ??
            getCountryConfig((countryId ?? "US").toUpperCase() as CountryId).legislature
              .lowerChamber.key);
      const url = endpointConfig?.whipUrl
        ? endpointConfig.whipUrl
        : isNational
          ? whipUrl
          : regionApiSubUrl(effectiveCountryId, stateId!, `party/${partyId}/whip`);
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          audience: "npp",
          targetType,
          targetId: election.id,
          chamber,
          direction: "for",
          candidacyId,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        showToast(data.message, "success");
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

  const handleGovernmentVoteWhip = async (
    voteId: string,
    direction: "for" | "against",
    targetType: "pmAppointmentVote" | "noConfidenceVote"
  ) => {
    setWhippingId(`cv_${voteId}_${direction}`);
    try {
      const config = getCountryConfig((countryId ?? "US").toUpperCase() as CountryId);
      const chamber = config.legislature.lowerChamber.key;
      const url = endpointConfig?.whipUrl ?? whipUrl;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          audience: "npp",
          targetType,
          targetId: voteId,
          chamber,
          direction,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        showToast(data.message, "success");
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

  const handleCabinetWhip = async (nominationId: string, direction: "for" | "against") => {
    setWhippingId(`cab_${nominationId}_${direction}`);
    try {
      const config = getCountryConfig((countryId ?? "US").toUpperCase() as CountryId);
      const chamber = config.upperElectionSystem
        ? (config.legislature.upperChamber?.key ?? config.legislature.lowerChamber.key)
        : config.legislature.lowerChamber.key;
      const url = endpointConfig?.whipUrl
        ? endpointConfig.whipUrl
        : isNational
          ? whipUrl
          : regionApiSubUrl(effectiveCountryId, stateId!, `party/${partyId}/whip`);
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          audience: "npp",
          targetType: "cabinetNomination",
          targetId: nominationId,
          chamber,
          direction,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        showToast(data.message, "success");
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

  const summarizeBillWhips = (
    whips: Array<{
      direction: string;
      attemptNumber: number;
      issuedByRole?: string;
      mode?: "soft" | "hard";
    }>
  ) =>
    whips
      .map(
        (whip) =>
          `${(whip.mode ?? "hard").toUpperCase()} ${whip.direction.toUpperCase()}${
            whip.issuedByRole ? ` by ${whip.issuedByRole}` : ""
          }`
      )
      .join(", ");

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-card-border bg-card px-4 py-3">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="space-y-1">
            <p className="text-sm text-muted">
              NPP Whips can be executed up to two times per bill or vote target. Each target keeps
              its own chamber-specific two-whip limit.
            </p>
            <p className="text-xs text-muted">
              Soft bill whips add advisory pressure to autonomous NPP voting. Leadership,
              government, and cabinet NPP whips continue to use the current immediate hard-whip
              resolution path.
            </p>
          </div>
          <div className="inline-flex rounded-lg border border-card-border bg-background p-1 self-start">
            {(["soft", "hard"] as const).map((mode) => {
              const active = whipMode === mode;
              return (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setWhipMode(mode)}
                  className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                    active ? "text-black" : "text-muted hover:text-text"
                  }`}
                  style={active ? { backgroundColor: partyColor } : undefined}
                >
                  {mode === "soft" ? "Soft Bills" : "Hard Bills"}
                </button>
              );
            })}
          </div>
        </div>
      </div>
      <WhipTabsLayout
        countryId={effectiveCountryId}
        isNational={isNational}
        preferredBillChamberKey={preferredBillChamberKey}
        renderBills={(chamberKey) => {
          const showStateSelector = isNational && chamberKey === "stateLegislature";
          const noEligibleStates = isNational && (!eligibleStates || eligibleStates.length === 0);
          const bills = billsByChamber[chamberKey] ?? [];

          return (
            <div className="space-y-3">
              {showStateSelector && (
                <div>
                  {noEligibleStates ? (
                    <p className="text-sm text-muted italic">
                      No eligible states. State legislature whips are managed by State Chairs in
                      states with active party members.
                    </p>
                  ) : (
                    <select
                      value={selectedState}
                      onChange={(e) => setSelectedState(e.target.value)}
                      aria-label="Select state"
                      className="w-full max-w-xs rounded-lg border border-card-border bg-card px-3 py-2 text-sm"
                    >
                      <option value="">Select a state...</option>
                      {eligibleStates?.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              )}

              {showStateSelector && !selectedState && !noEligibleStates ? (
                <p className="text-sm text-muted italic">Select a state to view whippable bills</p>
              ) : bills.length === 0 ? (
                <p className="text-sm text-muted italic">
                  No bills to whip here. This room lists a bill only while your party holds NPP
                  (AI-controlled) legislators in this chamber and that bill is in an open vote.
                </p>
              ) : (
                bills.map((item) => {
                  const whip = item.nppWhip ?? {
                    existingWhips: item.existingWhips,
                    canWhip: item.canWhip,
                  };
                  return (
                    <div
                      key={item.bill.id}
                      className="rounded-lg border border-card-border bg-card p-4"
                    >
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
                            {whip.existingWhips.length > 0 && (
                              <span className="text-xs px-2 py-0.5 rounded bg-primary/20 text-primary">
                                {summarizeBillWhips(whip.existingWhips)} (
                                {whip.existingWhips.length}
                                /2)
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="flex gap-2 shrink-0">
                          <button
                            onClick={() => handleBillWhip(item.bill.id, chamberKey, "for")}
                            disabled={!whip.canWhip || whippingId === item.bill.id}
                            title={!whip.canWhip ? "Maximum whip attempts reached" : undefined}
                            className="px-3 py-1.5 text-xs font-medium rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            style={{
                              backgroundColor: whip.canWhip ? `${partyColor}20` : undefined,
                              color: whip.canWhip ? partyColor : undefined,
                            }}
                          >
                            {whippingId === item.bill.id ? "Issuing..." : "Whip FOR"}
                          </button>
                          <button
                            onClick={() => handleBillWhip(item.bill.id, chamberKey, "against")}
                            disabled={!whip.canWhip || whippingId === item.bill.id}
                            className="px-3 py-1.5 text-xs font-medium rounded-md border border-card-border bg-card hover:bg-muted/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {whippingId === item.bill.id ? "Issuing..." : "Whip AGAINST"}
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })
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
                const whip = election.nppWhip ?? {
                  existingWhips: election.existingWhips,
                  canWhip: election.canWhip,
                };
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
                      <div className="text-xs text-muted mb-2">
                        Whips issued: {whip.existingWhips.length}/2
                      </div>
                    )}
                    {isPM ? (
                      <div className="flex flex-wrap gap-2">
                        <button
                          onClick={() =>
                            handleGovernmentVoteWhip(election.id, "for", "pmAppointmentVote")
                          }
                          disabled={!whip.canWhip || whippingId === `cv_${election.id}_for`}
                          className="px-3 py-1.5 text-xs font-medium rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                          style={{
                            backgroundColor: whip.canWhip ? `${partyColor}20` : undefined,
                            color: whip.canWhip ? partyColor : undefined,
                          }}
                        >
                          {whippingId === `cv_${election.id}_for` ? "Issuing..." : "Whip FOR"}
                        </button>
                        <button
                          onClick={() =>
                            handleGovernmentVoteWhip(election.id, "against", "pmAppointmentVote")
                          }
                          disabled={!whip.canWhip || whippingId === `cv_${election.id}_against`}
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
                          disabled={!whip.canWhip || whippingId === `cv_${election.id}_for`}
                          className="px-3 py-1.5 text-xs font-medium rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                          style={{
                            backgroundColor: whip.canWhip ? `${partyColor}20` : undefined,
                            color: whip.canWhip ? partyColor : undefined,
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
                          disabled={!whip.canWhip || whippingId === `cv_${election.id}_against`}
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
                              disabled={!whip.canWhip || isWhipped || whippingId === whipKey}
                              title={
                                !whip.canWhip
                                  ? "Maximum whip attempts reached"
                                  : isWhipped
                                    ? "Already whipped for this candidate"
                                    : undefined
                              }
                              className="px-3 py-1.5 text-xs font-medium rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                              style={{
                                backgroundColor:
                                  whip.canWhip && !isWhipped ? `${partyColor}20` : undefined,
                                color: whip.canWhip && !isWhipped ? partyColor : undefined,
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
                const whip = item.nppWhip ?? {
                  existingWhips: item.existingWhips,
                  canWhip: item.canWhip,
                };
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
                      <div className="text-xs text-muted mb-2">
                        Whips issued: {whip.existingWhips.length}/2
                      </div>
                    )}
                    <div className="flex flex-wrap gap-2">
                      <button
                        onClick={() => handleCabinetWhip(item.id, "for")}
                        disabled={!whip.canWhip || whippingId === `cab_${item.id}_for`}
                        className="px-3 py-1.5 text-xs font-medium rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        style={{
                          backgroundColor: whip.canWhip ? `${partyColor}20` : undefined,
                          color: whip.canWhip ? partyColor : undefined,
                        }}
                      >
                        {whippingId === `cab_${item.id}_for` ? "Issuing..." : "Whip FOR"}
                      </button>
                      <button
                        onClick={() => handleCabinetWhip(item.id, "against")}
                        disabled={!whip.canWhip || whippingId === `cab_${item.id}_against`}
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
