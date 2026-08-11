"use client";

import { useState, useEffect } from "react";
import { fetchJson } from "@/lib/observability/fetchJson";
import {
  mapSnapElectionViewerState,
  type ExecutiveGovernmentResponse,
} from "@/lib/government/executiveViewerState";
import { TariffsTab } from "@/components/legislature/TariffsTab";
import { SubsidiesTab } from "@/components/legislature/SubsidiesTab";
import { LeaderCard } from "@/components/legislature/LeaderCard";
import { getCountryConfig, type CountryId } from "@/lib/constants/countries";
import type { BillDisplay } from "@/lib/legislature/dto/billDisplay";
import { BillsList } from "@/components/bills/BillsList";
import { BillListControls, type BillVoteFilter } from "@/components/bills/BillListControls";
import { LegislatureCompositionSection } from "@/components/legislature/LegislatureCompositionSection";
import type { LegislatureCompositionData, LegislatureMember } from "@/components/legislature/types";
import LegislatureHeader from "./components/shared/LegislatureHeader";
import {
  useLegislatureData,
  type MembersData,
  type BillsData,
  type LeadersData,
} from "./components/shared/useLegislatureData";
import { PMSnapElectionButton } from "@/components/parliamentary/PMSnapElectionButton";
import { AdminSnapElectionButton } from "@/components/parliamentary/AdminSnapElectionButton";
import { ProposeLegislationModal } from "./ProposeLegislationModal";

/**
 * Unicameral devolved-parliament legislature page, shared by the seceded
 * nations Scotland (Holyrood) and Wales (Senedd). Both are Additional Member
 * System parliaments led by a First Minister, so a single config-driven page
 * serves both — chamber name + seats come from the country config, and the
 * per-nation copy (member title, presiding officer, hero) from DEVOLVED_META.
 *
 * Mirrors {@link IEOireachtasPage} minus the second chamber. SCO/WAL legislation
 * is not seeded yet (purposefully postponed), so the Bills tab reads empty until
 * those statute books are authored.
 */

interface DevolvedMeta {
  heroSlug: string;
  heroAlt: string;
  /** Short post-nominal for a member (MSP / MS). */
  memberAbbr: string;
  /** Plural label used in the propose banner + subtitle. */
  memberPlural: string;
  /** Chair of the chamber (Presiding Officer / Llywydd). */
  presidingOfficer: string;
  electoralSystem: string;
  /** How the chamber is referred to in the propose-bill banner copy. */
  proposeChamberLabel: string;
  /** ProposeLegislationModal domestic-only corporation label. */
  domesticOnlyLabel: string;
}

const DEVOLVED_META: Partial<Record<CountryId, DevolvedMeta>> = {
  SCO: {
    heroSlug: "holyrood",
    heroAlt: "The Scottish Parliament, Holyrood, Edinburgh",
    memberAbbr: "MSP",
    memberPlural: "MSPs",
    presidingOfficer: "Presiding Officer",
    electoralSystem: "Additional Member System",
    proposeChamberLabel: "Holyrood",
    domesticOnlyLabel: "Scottish-headquartered corporations only",
  },
  WAL: {
    heroSlug: "senedd",
    heroAlt: "The Senedd, Cardiff Bay",
    memberAbbr: "MS",
    memberPlural: "Members of the Senedd",
    presidingOfficer: "Llywydd",
    electoralSystem: "Additional Member System",
    proposeChamberLabel: "the Senedd",
    domesticOnlyLabel: "Welsh-headquartered corporations only",
  },
};

type PageTab = "bills" | "composition" | "leadership" | "tariffs" | "subsidies";

// ─── Composition Tab ──────────────────────────────────────────────────────────

function CompositionTab({
  members,
  loading,
  chamberLabel,
  countryId,
}: {
  members: MembersData | null;
  loading: boolean;
  chamberLabel: string;
  countryId: CountryId;
}) {
  if (loading) {
    return (
      <div className="space-y-3">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="h-10 rounded-lg bg-card/60 animate-pulse" />
        ))}
      </div>
    );
  }

  if (!members) {
    return <p className="text-center text-sm text-muted py-12">Composition data unavailable.</p>;
  }

  const compositionData: LegislatureCompositionData = {
    members: members.members.map((mp): LegislatureMember => ({
      id: mp.characterId,
      characterId: mp.characterId,
      sequentialId: mp.sequentialId ?? null,
      characterName: mp.characterName,
      avatarUrl: mp.avatarUrl,
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
      regionLabel={getCountryConfig(countryId).regionLabel}
      searchPlaceholder={`Search ${chamberLabel} members…`}
      countryId={countryId}
      parliamentChartVariant="hemicycle"
    />
  );
}

// ─── Bills Tab ────────────────────────────────────────────────────────────────

function BillsTab({
  bills,
  loading,
  countryId,
  chamberKey,
  chamberLabel,
  meta,
  onProposed,
}: {
  bills: BillsData | null;
  loading: boolean;
  countryId: CountryId;
  chamberKey: string;
  chamberLabel: string;
  meta: DevolvedMeta;
  onProposed: () => void;
}) {
  const [showModal, setShowModal] = useState(false);
  const [voteFilter, setVoteFilter] = useState<BillVoteFilter>("all");

  if (loading) {
    return (
      <div className="space-y-3">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="h-16 rounded-lg bg-card/60 animate-pulse" />
        ))}
      </div>
    );
  }

  if (!bills) {
    return <p className="text-center text-sm text-muted py-12">Bills data unavailable.</p>;
  }

  const {
    bills: billList,
    canPropose,
    hasActiveBill,
    adminOverride,
    blockedProvisions,
    proposalWarnings,
  } = bills;
  const filtered = (() => {
    if (voteFilter === "voted") return billList.filter((b: BillDisplay) => b.myVote != null);
    if (voteFilter === "not_voted") return billList.filter((b: BillDisplay) => b.myVote == null);
    return billList;
  })();

  return (
    <div className="space-y-4">
      {(canPropose || hasActiveBill) && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-primary/20 bg-primary/5 px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-foreground">
              {adminOverride
                ? `Admin — propose a ${meta.proposeChamberLabel} bill`
                : `You are a seated ${meta.memberAbbr} — propose a bill`}
            </p>
            <p className="text-xs text-muted">
              Opens to a vote among seated members of {chamberLabel} immediately.
            </p>
          </div>
          <button
            onClick={() => setShowModal(true)}
            className="shrink-0 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary/90 transition-colors"
          >
            Propose Bill
          </button>
        </div>
      )}

      <BillListControls
        voteFilter={voteFilter}
        onVoteFilterChange={setVoteFilter}
        showVoteFilter={canPropose}
      />

      <BillsList bills={filtered} onVoted={onProposed} />

      <p className="text-xs text-muted">
        {filtered.length} bill{filtered.length !== 1 ? "s" : ""} total
      </p>

      {showModal && (
        <ProposeLegislationModal
          hasActiveBill={!canPropose && Boolean(hasActiveBill)}
          adminOverride={adminOverride}
          countryId={countryId}
          blockedProvisions={blockedProvisions}
          proposalWarning={proposalWarnings?.[chamberKey] ?? null}
          chambers={[{ value: chamberKey, label: chamberLabel }]}
          domesticOnlyLabel={meta.domesticOnlyLabel}
          onClose={() => setShowModal(false)}
          onSuccess={() => {
            setShowModal(false);
            onProposed();
          }}
        />
      )}
    </div>
  );
}

// ─── Leadership Tab ───────────────────────────────────────────────────────────

function LeadershipTab({
  leaders,
  loading,
  countryId,
  chamberLabel,
  meta,
  governmentStatus,
  viewerIsSittingPM,
  snapElectionsAllowed,
  snapElectionsUsed,
  snapElectionsRemaining,
  snapCooldownTurnsRemaining,
  onRefresh,
}: {
  leaders: LeadersData | null;
  loading: boolean;
  countryId: CountryId;
  chamberLabel: string;
  meta: DevolvedMeta;
  governmentStatus: string | null;
  viewerIsSittingPM: boolean;
  snapElectionsAllowed: boolean;
  snapElectionsUsed: number;
  snapElectionsRemaining: number;
  snapCooldownTurnsRemaining: number;
  onRefresh: () => void;
}) {
  if (loading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2">
        {[...Array(2)].map((_, i) => (
          <div key={i} className="h-28 rounded-xl bg-card/60 animate-pulse" />
        ))}
      </div>
    );
  }

  if (!leaders) {
    return <p className="text-center text-sm text-muted py-12">Leadership data unavailable.</p>;
  }

  return (
    <div className="space-y-6">
      {governmentStatus === "formed" && viewerIsSittingPM && snapElectionsAllowed && (
        <div className="rounded-xl border border-warning/20 bg-warning/5 px-4 py-3">
          <div className="mb-2 flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-foreground">Dissolve {chamberLabel}</p>
              <p className="text-xs text-muted">
                As First Minister, you may call a snap election. All active legislation will fail.
              </p>
            </div>
          </div>
          <PMSnapElectionButton
            countryId={countryId}
            snapElectionsUsed={snapElectionsUsed}
            snapElectionsRemaining={snapElectionsRemaining}
            cooldownTurnsRemaining={snapCooldownTurnsRemaining}
            onTriggered={onRefresh}
          />
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <LeaderCard
          title="First Minister"
          subtitle="Head of Government"
          character={leaders.primeMinister}
        />
        <LeaderCard
          title="Opposition Leader"
          subtitle="Leader of the largest non-governing party"
          character={leaders.oppositionLeader}
        />
      </div>

      <div className="rounded-xl border border-card-border/40 bg-card-muted/30 p-4">
        <p className="text-xs text-muted leading-relaxed">
          The First Minister is nominated by {chamberLabel} and leads the devolved government. The{" "}
          {meta.presidingOfficer} presides over the chamber. The Opposition Leader heads the largest
          party not in the governing administration.
        </p>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function DevolvedParliamentPage({ countryId }: { countryId: CountryId }) {
  const config = getCountryConfig(countryId);
  const meta = DEVOLVED_META[countryId];
  const chamberKey = config.legislature.lowerChamber.key;
  const chamberLabel = config.legislature.name;
  const seats = config.legislature.lowerChamber.seats;

  const { members, bills, leaders, loading, error, refetch } = useLegislatureData(
    countryId,
    chamberKey
  );
  const [activeTab, setActiveTab] = useState<PageTab>("bills");

  const [governmentStatus, setGovernmentStatus] = useState<string | null>(null);
  const [viewerIsSittingPM, setViewerIsSittingPM] = useState(false);
  const [snapElectionsAllowed, setSnapElectionsAllowed] = useState(false);
  const [snapElectionsUsed, setSnapElectionsUsed] = useState(0);
  const [snapElectionsRemaining, setSnapElectionsRemaining] = useState(0);
  const [snapCooldownTurnsRemaining, setSnapCooldownTurnsRemaining] = useState(0);

  const fetchGovernmentData = () => {
    fetchJson<ExecutiveGovernmentResponse>(`/api/country/${countryId.toLowerCase()}/executive`, {
      feature: "devolved-parliament-government",
    })
      .then((data) => {
        if (!data) return;
        const snap = mapSnapElectionViewerState(data);
        setGovernmentStatus(data.government?.status ?? null);
        setViewerIsSittingPM(snap.viewerIsSittingPM);
        setSnapElectionsAllowed(snap.snapElectionsAllowed);
        setSnapElectionsUsed(snap.snapElectionsUsed);
        setSnapElectionsRemaining(snap.snapElectionsRemaining);
        setSnapCooldownTurnsRemaining(snap.snapCooldownTurnsRemaining);
      })
      .catch(() => {});
  };

  useEffect(() => {
    fetchGovernmentData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [countryId]);

  if (!meta) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <p className="text-muted">{config.name} legislature coming soon.</p>
      </div>
    );
  }

  const majorityParty = members?.composition[0];
  const headerStats = {
    majorityParty: {
      name: majorityParty?.partyName ?? "—",
      color: majorityParty?.partyColor ?? "#888888",
      seats: majorityParty?.seats ?? 0,
    },
    totalSeats: members?.totalSeats ?? seats,
    leader: leaders?.primeMinister
      ? {
          label: "First Minister",
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

  const TABS: { id: PageTab; label: string }[] = [
    { id: "bills", label: "Bills" },
    { id: "composition", label: "Composition" },
    { id: "leadership", label: "Leadership" },
    { id: "tariffs", label: "Tariffs" },
    { id: "subsidies", label: "Subsidies" },
  ];

  return (
    <div className="min-h-screen bg-background">
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        {loading ? (
          <div className="mb-5 h-[220px] rounded-2xl bg-card/60 animate-pulse" />
        ) : (
          <LegislatureHeader
            countryId={countryId}
            title={chamberLabel}
            subtitle={`${seats} ${meta.memberPlural} · ${meta.electoralSystem} · ${config.name}`}
            heroImage={`/api/images/hero/${meta.heroSlug}`}
            heroAlt={meta.heroAlt}
            stats={headerStats}
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

        <div className="mb-5 flex items-center gap-1 border-b border-card-border/60">
          {TABS.map(({ id, label }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className={`px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px ${
                activeTab === id
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted hover:text-foreground"
              }`}
            >
              {label}
            </button>
          ))}
          {bills?.adminOverride && (
            <div className="ml-auto pb-1">
              <AdminSnapElectionButton
                countryId={countryId}
                onDone={() => {
                  refetch();
                  fetchGovernmentData();
                }}
              />
            </div>
          )}
        </div>

        {activeTab === "composition" && (
          <CompositionTab
            members={members}
            loading={loading}
            chamberLabel={chamberLabel}
            countryId={countryId}
          />
        )}
        {activeTab === "bills" && (
          <BillsTab
            bills={bills}
            loading={loading}
            countryId={countryId}
            chamberKey={chamberKey}
            chamberLabel={chamberLabel}
            meta={meta}
            onProposed={refetch}
          />
        )}
        {activeTab === "leadership" && (
          <LeadershipTab
            leaders={leaders}
            loading={loading}
            countryId={countryId}
            chamberLabel={chamberLabel}
            meta={meta}
            governmentStatus={governmentStatus}
            viewerIsSittingPM={viewerIsSittingPM}
            snapElectionsAllowed={snapElectionsAllowed}
            snapElectionsUsed={snapElectionsUsed}
            snapElectionsRemaining={snapElectionsRemaining}
            snapCooldownTurnsRemaining={snapCooldownTurnsRemaining}
            onRefresh={() => {
              refetch();
              fetchGovernmentData();
            }}
          />
        )}
        {activeTab === "tariffs" && <TariffsTab countryId={countryId} />}
        {activeTab === "subsidies" && <SubsidiesTab countryId={countryId} />}
      </main>
    </div>
  );
}
