"use client";

import { useState, useEffect, useCallback } from "react";
import { useJPDietPageState } from "./useJPDietPageState";
import { fetchJson } from "@/lib/observability/fetchJson";
import type { ExecutiveGovernmentResponse } from "@/lib/government/executiveViewerState";
import Link from "next/link";
import { Avatar } from "@/components/Avatar";
import { LegislatureCompositionSection } from "@/components/legislature/LegislatureCompositionSection";
import type { LegislatureCompositionData, LegislatureMember } from "@/components/legislature/types";
import { useToast } from "@/contexts/ToastContext";
import type { BillDisplay } from "@/lib/legislature/dto/billDisplay";
import { BillsList } from "@/components/bills/BillsList";
import { BillAutoFailWarningBanner } from "@/components/bills/BillAutoFailWarning";
import { BillListControls, type BillVoteFilter } from "@/components/bills/BillListControls";
import type { CountryId } from "@/lib/constants/countries";
import { COUNTRY_CONFIGS } from "@/lib/constants/countries";
import { TariffsTab } from "@/components/legislature/TariffsTab";
import { SubsidiesTab } from "@/components/legislature/SubsidiesTab";
import GovernmentVotePanel from "@/components/uk/GovernmentVotePanel";
import AppointPMModal from "@/components/uk/AppointPMModal";
import LegislatureHeader from "./components/shared/LegislatureHeader";
import { useLegislatureData, type MembersData } from "./components/shared/useLegislatureData";
import { ProposeLegislationModal } from "./ProposeLegislationModal";
import { JPCabinetProposeBillModal } from "./JPCabinetProposeBillModal";
import { PMSnapElectionButton } from "@/components/parliamentary/PMSnapElectionButton";
import {
  matchesLegislatureBillStatusFilter,
  type LegislatureBillStatusFilter,
} from "@/lib/legislature/billStatusFilters";
import type { BillProposalAutoFailWarning } from "@/lib/legislature/billAutoFailWarning";

const DIET_HERO = {
  image: "/api/images/hero/national-diet",
  alt: "The National Diet Building, Tokyo",
};

type ChamberKey = "shugiin" | "sangiin" | "cabinet";
type PageTab = "composition" | "bills" | "leadership" | "tariffs" | "subsidies";

const LEGISLATURE_STATUS_FILTERS = [
  { value: "all", label: "All" },
  { value: "voting", label: "Voting" },
  { value: "passed", label: "Passed" },
  { value: "failed", label: "Failed" },
] satisfies Array<{ value: LegislatureBillStatusFilter; label: string }>;

// ─── Composition Sub-component ──────────────────────────────────────────────

function ChamberComposition({
  members,
  chamberLabel,
  countryId,
}: {
  members: MembersData;
  chamberLabel: string;
  countryId: CountryId;
}) {
  const compositionData: LegislatureCompositionData = {
    members: members.members.map((mp): LegislatureMember => ({
      id: mp.characterId,
      characterId: mp.characterId,
      sequentialId: mp.sequentialId ?? null,
      characterName: mp.characterName,
      region: mp.constituency,
      party: mp.party,
      partyName: mp.partyName,
      partyColor: mp.partyColor,
      countryId,
      seatsHeld: mp.seatsHeld,
      isNPP: mp.isNPP,
      isVacant: false,
    })),
    composition: members.composition.map((c) => ({
      party: c.partyId,
      partyName: c.partyName,
      partyColor: c.partyColor,
      economicPosition: c.economicPosition,
      seats: c.seats,
      countryId,
    })),
    totalSeats: members.totalSeats,
    filledSeats: members.filledSeats,
  };

  return (
    <LegislatureCompositionSection
      data={compositionData}
      chamberLabel={chamberLabel}
      showSeatsColumn={true}
      regionLabel="Region"
      searchPlaceholder={`Search ${chamberLabel} members...`}
      countryId={countryId}
    />
  );
}

// ─── Main Page ──────────────────────────────────────────────────────────────

interface Props {
  countryId: CountryId;
}

export function JPDietPage({ countryId }: Props) {
  const config = COUNTRY_CONFIGS[countryId];
  const lowerName = config?.legislature?.lowerChamber?.name ?? "Shūgiin";
  const upperName = config?.legislature?.upperChamber?.name ?? "Sangiin";
  const lowerSeats = config?.legislature?.lowerChamber?.seats ?? 465;
  const upperSeats = config?.legislature?.upperChamber?.seats ?? 248;

  const [activeChamber, setActiveChamber] = useState<ChamberKey>("sangiin");
  const [activeTab, setActiveTab] = useState<PageTab>("bills");

  // Reset to bills-only when switching to cabinet
  const handleChamberSwitch = useCallback((chamber: string) => {
    const key = chamber as ChamberKey;
    setActiveChamber(key);
    if (key === "cabinet") {
      setActiveTab("bills");
    }
  }, []);

  // Fetch data for both chambers. Bills are chamber-scoped (currentChamber filter
  // on the API), so each call returns only that chamber's active bills; we
  // select the visible set below based on activeChamber.
  const {
    members: shugiinMembers,
    bills: shugiinBills,
    leaders,
    loading: shugiinLoading,
    error: shugiinError,
    refetch: shugiinRefetch,
  } = useLegislatureData(countryId, "shugiin");

  const {
    members: sangiinMembers,
    bills: sangiinBills,
    loading: sangiinLoading,
    refetch: sangiinRefetch,
  } = useLegislatureData(countryId, "sangiin");

  const bills = activeChamber === "sangiin" ? sangiinBills : shugiinBills;

  const loading =
    activeChamber === "shugiin"
      ? shugiinLoading
      : activeChamber === "sangiin"
        ? sangiinLoading
        : shugiinLoading;
  const error = shugiinError;
  const refetch = useCallback(() => {
    shugiinRefetch();
    sangiinRefetch();
  }, [shugiinRefetch, sangiinRefetch]);

  // Government formation data for Leadership tab
  type GovernmentData = {
    status: string;
    pmName: string | null;
    formationType: string | null;
  } | null;
  type ActiveVoteData = {
    type: string;
    _id: string;
    status: string;
    closesAt: string;
    closesOnTurn?: number | null;
    votesFor: number;
    votesAgainst: number;
    [key: string]: unknown;
  };
  const [government, setGovernment] = useState<GovernmentData>(null);
  const [activeAppointmentVotes, setActiveAppointmentVotes] = useState<ActiveVoteData[]>([]);
  const [activeNoConfidenceVote, setActiveNoConfidenceVote] = useState<ActiveVoteData | null>(null);
  const {
    viewerMayAppoint,
    viewerMayProposeNoConfidence,
    viewerIsMp,
    viewerIsSittingPM,
    snapElectionsAllowed,
    snapElectionsUsed,
    snapElectionsRemaining,
    snapCooldownTurnsRemaining,
    appointModalOpen,
    noConfirmOpen,
    proposingNoConfidence,
    viewerIsAdmin,
    myHasActiveBill,
    showProposeModal,
    showCabinetProposeModal,
    canProposeCabinetBill,
    syncGovernmentData,
    setViewerIsAdmin,
    setMyHasActiveBill,
    setAppointModalOpen,
    setNoConfirmOpen,
    setProposingNoConfidence,
    setShowProposeModal,
    setShowCabinetProposeModal,
    setCanProposeCabinetBill,
  } = useJPDietPageState();
  const [noConfidenceCooldownTurns, setNoConfidenceCooldownTurns] = useState<number | null>(null);
  const [viewerVotes, setViewerVotes] = useState<Record<string, "aye" | "nay">>({});
  const [viewerWhippedFrom, setViewerWhippedFrom] = useState<Record<string, string>>({});
  const { showToast } = useToast();

  // Which Diet chamber (if any) the viewer holds a seat in. Drives propose-bill
  // button visibility — Shugiin members can only propose from the Shugiin tab,
  // Sangiin members only from the Sangiin tab.
  const [mySeat, setMySeat] = useState<"shugiin" | "sangiin" | null>(null);

  // Bills list view controls.
  const [billVoteFilter, setBillVoteFilter] = useState<BillVoteFilter>("all");
  const [billStatusFilter, setBillStatusFilter] = useState<LegislatureBillStatusFilter>("all");

  useEffect(() => {
    fetchJson<{ user?: { isAdmin?: boolean; character?: { id?: string } } }>("/api/auth/me", {
      cache: "no-store",
      feature: "jp-diet-viewer",
    })
      .then((data) => {
        setViewerIsAdmin(Boolean(data?.user?.isAdmin));
        const charId: string | undefined = data?.user?.character?.id;
        if (!charId) return;
        fetchJson<{ members?: { characterId: string }[] }>(
          `/api/country/${countryId.toLowerCase()}/legislature/members?chamber=shugiin`,
          { feature: "jp-diet-members" }
        )
          .then((d) => {
            if (d?.members?.some((m) => m.characterId === charId)) setMySeat("shugiin");
          })
          .catch(() => {});
        fetchJson<{ members?: { characterId: string }[] }>(
          `/api/country/${countryId.toLowerCase()}/legislature/members?chamber=sangiin`,
          { feature: "jp-diet-members" }
        )
          .then((d) => {
            if (d?.members?.some((m) => m.characterId === charId)) setMySeat("sangiin");
          })
          .catch(() => {});
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [countryId]);

  useEffect(() => {
    setMyHasActiveBill(bills?.hasActiveBill ?? false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bills?.hasActiveBill]);

  const canAdminOverridePropose = activeChamber !== "cabinet" && !!bills?.adminOverride;
  const canSeatPropose = activeChamber !== "cabinet" && mySeat === activeChamber;
  const proposeOriginChamber =
    activeChamber === "sangiin" || activeChamber === "shugiin" ? activeChamber : null;
  const proposeChamberLabel =
    activeChamber === "sangiin" ? upperName : activeChamber === "shugiin" ? lowerName : null;

  const fetchGovernmentData = useCallback(() => {
    fetchJson<ExecutiveGovernmentResponse>(`/api/country/${countryId.toLowerCase()}/executive`, {
      feature: "jp-diet-government",
    })
      .then((data) => {
        if (!data) return;
        setGovernment(data.government ?? null);
        setActiveAppointmentVotes(data.activeAppointmentVotes ?? []);
        setActiveNoConfidenceVote(data.activeNoConfidenceVote ?? null);
        syncGovernmentData(data);
        setNoConfidenceCooldownTurns(data.noConfidenceCooldownTurns ?? null);
        setViewerVotes(data.viewerVotes ?? {});
        setViewerWhippedFrom(data.viewerWhippedFrom ?? {});
      })
      .catch(() => {});
  }, [countryId, syncGovernmentData]);

  useEffect(() => {
    fetchGovernmentData();
  }, [fetchGovernmentData]);

  async function handleProposeNoConfidence() {
    setProposingNoConfidence(true);
    setNoConfirmOpen(false);
    try {
      const res = await fetch(`/api/country/${countryId.toLowerCase()}/pm/no-confidence`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) {
        showToast(data.error ?? "Failed to propose no-confidence motion.", "error");
      } else {
        showToast("No-confidence motion proposed.", "success");
        fetchGovernmentData();
      }
    } catch {
      showToast("Network error.", "error");
    } finally {
      setProposingNoConfidence(false);
    }
  }

  // Cabinet bills
  const [cabinetBills, setCabinetBills] = useState<BillDisplay[]>([]);
  const [cabinetProposalWarning, setCabinetProposalWarning] =
    useState<BillProposalAutoFailWarning | null>(null);
  const [cabinetBlockedProvisions, setCabinetBlockedProvisions] = useState<
    { legislationTypeId: string; policyOptionId: string }[]
  >([]);
  const [cabinetProposalDomains, setCabinetProposalDomains] = useState<string[] | null>([]);
  const refetchCabinetBills = useCallback(() => {
    fetchJson<{
      bills?: BillDisplay[];
      proposalWarning?: BillProposalAutoFailWarning | null;
      blockedProvisions?: { legislationTypeId: string; policyOptionId: string }[];
      proposalAccess?: {
        canPropose?: boolean;
        allowedPolicyDomains?: string[] | null;
      };
    }>(`/api/country/${countryId.toLowerCase()}/legislature/cabinet-bills`, {
      feature: "jp-diet-cabinet-bills",
    })
      .then((data) => {
        setCabinetBills(data.bills ?? []);
        setCabinetProposalWarning(data.proposalWarning ?? null);
        setCabinetBlockedProvisions(data.blockedProvisions ?? []);
        setCanProposeCabinetBill(Boolean(data.proposalAccess?.canPropose));
        setCabinetProposalDomains(data.proposalAccess?.allowedPolicyDomains ?? []);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [countryId]);

  useEffect(() => {
    refetchCabinetBills();
  }, [refetchCabinetBills]);

  // ── Stats strip ─────────────────────────────────────────────────────────────
  const activeMembers = activeChamber === "sangiin" ? sangiinMembers : shugiinMembers;
  const majorityParty = activeMembers?.composition[0];
  const activeTotalSeats =
    activeChamber === "sangiin"
      ? upperSeats
      : activeChamber === "cabinet"
        ? lowerSeats
        : lowerSeats;
  const _activeChamberLabel =
    activeChamber === "sangiin" ? upperName : activeChamber === "cabinet" ? "Cabinet" : lowerName;

  const headerStats = {
    majorityParty: {
      name: majorityParty?.partyName ?? "—",
      color: majorityParty?.partyColor ?? "#888888",
      seats: majorityParty?.seats ?? 0,
    },
    totalSeats: activeTotalSeats,
    leader: leaders?.primeMinister
      ? {
          label: "Prime Minister",
          name: leaders.primeMinister.characterName,
          id: leaders.primeMinister.characterId,
          sequentialId: leaders.primeMinister.sequentialId,
        }
      : null,
    minorityLeader: leaders?.oppositionLeader
      ? {
          label: "Opposition Leader",
          name: leaders.oppositionLeader.characterName,
          id: leaders.oppositionLeader.characterId,
          sequentialId: leaders.oppositionLeader.sequentialId,
        }
      : null,
  };

  // ── Tab configuration ───────────────────────────────────────────────────────
  const ALL_TABS: { key: PageTab; label: string }[] = [
    { key: "bills", label: "Bills" },
    { key: "composition", label: "Composition" },
    { key: "leadership", label: "Leadership" },
    { key: "tariffs", label: "Tariffs" },
    { key: "subsidies", label: "Subsidies" },
  ];

  // Cabinet chamber only shows Bills
  const visibleTabs =
    activeChamber === "cabinet" ? ALL_TABS.filter((t) => t.key === "bills") : ALL_TABS;

  return (
    <div className="min-h-screen bg-background">
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        {loading ? (
          <div className="mb-5 h-[220px] rounded-2xl bg-card/60 animate-pulse" />
        ) : (
          <LegislatureHeader
            countryId={countryId}
            title={
              activeChamber === "sangiin"
                ? `${upperName} (House of Councillors)`
                : activeChamber === "shugiin"
                  ? `${lowerName} (House of Representatives)`
                  : "Cabinet"
            }
            subtitle={
              activeChamber === "cabinet"
                ? `Cabinet bills for the ${lowerName} · Japan`
                : `${activeTotalSeats} seats · Japan`
            }
            heroImage={DIET_HERO.image}
            heroAlt={DIET_HERO.alt}
            stats={headerStats}
            chamberSwitcher={{
              active: activeChamber,
              onSwitch: handleChamberSwitch,
              options: [
                { key: "sangiin", label: upperName },
                { key: "shugiin", label: lowerName },
                { key: "cabinet", label: "Cabinet" },
              ],
            }}
          />
        )}

        {!loading && error && (
          <div className="mb-4 flex items-center justify-between rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning">
            <span>Some data failed to load.</span>
            <button
              onClick={refetch}
              className="ml-3 underline hover:text-warning/80 transition-colors"
            >
              Retry
            </button>
          </div>
        )}

        {/* Sub-tab bar */}
        <div className="mb-6 flex rounded-lg border border-card-border overflow-x-auto overflow-y-hidden">
          {visibleTabs.map(({ key, label }) => (
            <button
              key={key}
              role="tab"
              aria-selected={activeTab === key}
              aria-controls="diet-content"
              onClick={() => setActiveTab(key)}
              className={`px-4 py-2 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
                activeTab === key
                  ? "bg-card-border text-foreground"
                  : "bg-card text-muted hover:text-foreground"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div id="diet-content" role="tabpanel">
          {/* Composition */}
          {activeTab === "composition" && activeChamber !== "cabinet" && (
            <>
              {activeChamber === "shugiin" &&
                (shugiinMembers ? (
                  <ChamberComposition
                    members={shugiinMembers}
                    chamberLabel={lowerName}
                    countryId={countryId}
                  />
                ) : shugiinLoading ? (
                  <div className="space-y-3">
                    {Array.from({ length: 4 }).map((_, i) => (
                      <div key={i} className="h-16 rounded-xl bg-card/60 animate-pulse" />
                    ))}
                  </div>
                ) : (
                  <p className="text-muted text-center py-12">
                    No {lowerName} composition data available.
                  </p>
                ))}
              {activeChamber === "sangiin" &&
                (sangiinMembers ? (
                  <ChamberComposition
                    members={sangiinMembers}
                    chamberLabel={upperName}
                    countryId={countryId}
                  />
                ) : sangiinLoading ? (
                  <div className="space-y-3">
                    {Array.from({ length: 4 }).map((_, i) => (
                      <div key={i} className="h-16 rounded-xl bg-card/60 animate-pulse" />
                    ))}
                  </div>
                ) : (
                  <p className="text-muted text-center py-12">
                    No {upperName} composition data available.
                  </p>
                ))}
            </>
          )}

          {/* Bills */}
          {activeTab === "bills" && activeChamber !== "cabinet" && (
            <div className="space-y-4">
              {canAdminOverridePropose && proposeChamberLabel && (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-primary/20 bg-primary/5 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-foreground">
                      {`Admin — propose a ${proposeChamberLabel} bill`}
                    </p>
                    <p className="text-xs text-muted">
                      Opens to a vote in the currently selected Diet chamber immediately.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowProposeModal(true)}
                    className="shrink-0 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary/90 transition-colors"
                  >
                    Propose Bill
                  </button>
                </div>
              )}

              {canSeatPropose && !canAdminOverridePropose && (
                <div className="flex items-center justify-end">
                  <button
                    type="button"
                    onClick={() => setShowProposeModal(true)}
                    className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary/90 transition-colors"
                  >
                    Propose Bill
                  </button>
                </div>
              )}

              <BillListControls
                voteFilter={billVoteFilter}
                onVoteFilterChange={setBillVoteFilter}
                showVoteFilter={canSeatPropose || canAdminOverridePropose}
                statusFilter={billStatusFilter}
                statusFilterOptions={LEGISLATURE_STATUS_FILTERS}
                onStatusFilterChange={(filter) =>
                  setBillStatusFilter(filter as LegislatureBillStatusFilter)
                }
              />

              {(() => {
                const billList = bills?.bills ?? [];
                const filtered = billList.filter((bill) => {
                  if (!matchesLegislatureBillStatusFilter(bill.status, billStatusFilter))
                    return false;
                  if (billVoteFilter === "voted") return bill.myVote != null;
                  if (billVoteFilter === "not_voted") return bill.myVote == null;
                  return true;
                });

                if (billList.length === 0) {
                  return (
                    <p className="text-muted text-center py-12">No active bills in the Kokkai.</p>
                  );
                }
                return <BillsList bills={filtered} onVoted={refetch} />;
              })()}
            </div>
          )}

          {/* Cabinet Bills */}
          {activeTab === "bills" && activeChamber === "cabinet" && (
            <div className="space-y-4">
              {cabinetProposalWarning && (
                <BillAutoFailWarningBanner warning={cabinetProposalWarning} />
              )}
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted">
                  Cabinet bills proposed by eligible cabinet members. These bills go through cabinet
                  review before entering the {lowerName}.
                </p>
                <div className="flex items-center gap-2">
                  <Link
                    href={`/country/${countryId.toLowerCase()}/executive/cabinet`}
                    className="shrink-0 rounded-lg border border-card-border bg-card px-4 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-card-border/60"
                  >
                    Open Cabinet
                  </Link>
                  <button
                    type="button"
                    onClick={() => setShowCabinetProposeModal(true)}
                    disabled={!canProposeCabinetBill}
                    className="shrink-0 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary/90 disabled:opacity-50"
                  >
                    Propose Bill
                  </button>
                </div>
              </div>
              {cabinetBills.length > 0 ? (
                <BillsList bills={cabinetBills} onVoted={refetchCabinetBills} />
              ) : (
                <p className="text-muted text-center py-12">No cabinet bills pending.</p>
              )}
            </div>
          )}

          {/* Leadership */}
          {activeTab === "leadership" && activeChamber !== "cabinet" && (
            <div className="space-y-6">
              {/* Appoint PM */}
              {government?.status === "pending" && viewerMayAppoint && (
                <div className="flex items-center justify-between rounded-xl border border-primary/20 bg-primary/5 px-4 py-3">
                  <div>
                    <p className="text-sm font-medium text-foreground">
                      Government pending formation
                    </p>
                    <p className="text-xs text-muted">
                      As party or coalition chair, you may nominate a PM.
                    </p>
                  </div>
                  <button
                    onClick={() => setAppointModalOpen(true)}
                    className="shrink-0 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary/90 transition-colors"
                  >
                    Appoint Prime Minister
                  </button>
                </div>
              )}

              {/* PM snap election — sitting PM only, where the country permits snaps */}
              {government?.status === "formed" && viewerIsSittingPM && snapElectionsAllowed && (
                <div className="rounded-xl border border-warning/20 bg-warning/5 px-4 py-3">
                  <div className="mb-2">
                    <p className="text-sm font-medium text-foreground">Dissolve the Shūgiin</p>
                    <p className="text-xs text-muted">
                      As Prime Minister, you may call a snap election. All active legislation will
                      fail.
                    </p>
                  </div>
                  <PMSnapElectionButton
                    countryId={countryId}
                    snapElectionsUsed={snapElectionsUsed}
                    snapElectionsRemaining={snapElectionsRemaining}
                    cooldownTurnsRemaining={snapCooldownTurnsRemaining}
                    onTriggered={fetchGovernmentData}
                  />
                </div>
              )}

              {/* Propose No-Confidence */}
              {government?.status === "formed" && viewerIsMp && !activeNoConfidenceVote && (
                <div className="flex items-center justify-between rounded-xl border border-warning/20 bg-warning/5 px-4 py-3">
                  <div>
                    <p className="text-sm font-medium text-foreground">
                      Propose a no-confidence motion
                    </p>
                    <p className="text-xs text-muted">
                      {noConfidenceCooldownTurns && noConfidenceCooldownTurns > 0
                        ? `Cooldown: ${noConfidenceCooldownTurns} turn${noConfidenceCooldownTurns === 1 ? "" : "s"} remaining`
                        : `As an elected ${lowerName} member you may challenge the sitting Prime Minister.`}
                    </p>
                  </div>
                  {noConfidenceCooldownTurns && noConfidenceCooldownTurns > 0 ? (
                    <button
                      disabled
                      className="shrink-0 rounded-lg border border-warning/20 bg-warning/5 px-4 py-2 text-sm font-semibold text-warning/40 cursor-not-allowed opacity-50"
                    >
                      Propose No-Confidence
                    </button>
                  ) : noConfirmOpen ? (
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-xs text-warning">Are you sure?</span>
                      <button
                        onClick={handleProposeNoConfidence}
                        disabled={proposingNoConfidence || !viewerMayProposeNoConfidence}
                        className="rounded-lg bg-warning px-3 py-1.5 text-xs font-semibold text-black hover:bg-warning/90 disabled:opacity-50 transition-colors"
                      >
                        {proposingNoConfidence ? "Proposing…" : "Confirm"}
                      </button>
                      <button
                        onClick={() => setNoConfirmOpen(false)}
                        className="rounded-lg border border-card-border px-3 py-1.5 text-xs text-muted hover:text-foreground transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setNoConfirmOpen(true)}
                      disabled={!viewerMayProposeNoConfidence}
                      className="shrink-0 rounded-lg border border-warning/40 bg-warning/10 px-4 py-2 text-sm font-semibold text-warning hover:bg-warning/20 disabled:opacity-50 transition-colors"
                    >
                      Propose No-Confidence
                    </button>
                  )}
                </div>
              )}

              {/* Active appointment vote panels (multiple) */}
              {activeAppointmentVotes.map((vote) => (
                <GovernmentVotePanel
                  key={vote._id}
                  vote={vote as unknown as Parameters<typeof GovernmentVotePanel>[0]["vote"]}
                  countryCode={countryId.toLowerCase()}
                  canVote={viewerIsMp}
                  viewerVote={viewerVotes[vote._id] ?? null}
                  myWhippedFrom={viewerWhippedFrom[vote._id] ?? null}
                  onVoteCast={fetchGovernmentData}
                />
              ))}

              {/* Active no-confidence vote panel (single) */}
              {activeNoConfidenceVote && (
                <GovernmentVotePanel
                  vote={
                    activeNoConfidenceVote as unknown as Parameters<
                      typeof GovernmentVotePanel
                    >[0]["vote"]
                  }
                  countryCode={countryId.toLowerCase()}
                  canVote={viewerIsMp}
                  viewerVote={viewerVotes[activeNoConfidenceVote._id] ?? null}
                  myWhippedFrom={viewerWhippedFrom[activeNoConfidenceVote._id] ?? null}
                  onVoteCast={fetchGovernmentData}
                />
              )}

              {/* Leader cards */}
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="rounded-xl border border-card-border bg-card p-5">
                  <p className="text-xs font-semibold uppercase tracking-widest text-muted mb-2">
                    Prime Minister
                  </p>
                  {leaders?.primeMinister ? (
                    <div className="flex items-center gap-3">
                      <Avatar
                        url={leaders.primeMinister.avatarUrl}
                        name={leaders.primeMinister.characterName}
                        size="h-12 w-12"
                        className="rounded-lg"
                      />
                      <div>
                        <Link
                          href={`/character/${leaders.primeMinister.sequentialId ?? leaders.primeMinister.characterId}`}
                          className="font-semibold hover:text-primary transition-colors"
                        >
                          {leaders.primeMinister.characterName}
                        </Link>
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm italic text-muted">Vacant</p>
                  )}
                </div>
                <div className="rounded-xl border border-card-border bg-card p-5">
                  <p className="text-xs font-semibold uppercase tracking-widest text-muted mb-2">
                    Opposition Leader
                  </p>
                  {leaders?.oppositionLeader ? (
                    <div className="flex items-center gap-3">
                      <Avatar
                        url={leaders.oppositionLeader.avatarUrl}
                        name={leaders.oppositionLeader.characterName}
                        size="h-12 w-12"
                        className="rounded-lg"
                      />
                      <div>
                        <Link
                          href={`/character/${leaders.oppositionLeader.sequentialId ?? leaders.oppositionLeader.characterId}`}
                          className="font-semibold hover:text-primary transition-colors"
                        >
                          {leaders.oppositionLeader.characterName}
                        </Link>
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm italic text-muted">Vacant</p>
                  )}
                </div>
              </div>

              <div className="rounded-xl border border-card-border/40 bg-card-muted/30 p-4">
                <p className="text-xs text-muted leading-relaxed">
                  The Prime Minister is the leader of the party commanding a majority in the{" "}
                  {lowerName}. The Opposition Leader is the chair of the largest non-governing party
                  or coalition.
                </p>
              </div>

              <AppointPMModal
                countryCode={countryId.toLowerCase()}
                open={appointModalOpen}
                onClose={() => setAppointModalOpen(false)}
                onSuccess={() => {
                  setAppointModalOpen(false);
                  fetchGovernmentData();
                }}
              />
            </div>
          )}

          {/* Tariffs */}
          {activeTab === "tariffs" && activeChamber !== "cabinet" && (
            <TariffsTab countryId={countryId} />
          )}

          {/* Subsidies */}
          {activeTab === "subsidies" && activeChamber !== "cabinet" && (
            <SubsidiesTab countryId={countryId} />
          )}
        </div>
      </main>

      {showProposeModal && proposeOriginChamber && proposeChamberLabel && (
        <ProposeLegislationModal
          countryId={countryId}
          adminOverride={canAdminOverridePropose}
          hasActiveBill={myHasActiveBill}
          chambers={[
            { value: "shugiin", label: "Shūgiin" },
            { value: "sangiin", label: "Sangiin" },
          ]}
          defaultChamber={proposeOriginChamber}
          blockedProvisions={bills?.blockedProvisions}
          proposalWarnings={bills?.proposalWarnings}
          domesticOnlyLabel="Japan-headquartered corporations only"
          onClose={() => setShowProposeModal(false)}
          onSuccess={() => {
            setShowProposeModal(false);
            shugiinRefetch();
            sangiinRefetch();
          }}
        />
      )}

      {showCabinetProposeModal && (
        <JPCabinetProposeBillModal
          countryId={countryId}
          proposalWarning={cabinetProposalWarning}
          blockedProvisions={cabinetBlockedProvisions}
          allowedPolicyDomains={cabinetProposalDomains}
          adminOverride={viewerIsAdmin}
          onClose={() => setShowCabinetProposeModal(false)}
          onSuccess={() => {
            setShowCabinetProposeModal(false);
            refetchCabinetBills();
          }}
        />
      )}
    </div>
  );
}
