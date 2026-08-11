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
import { IESeanadCompositionPanel } from "./IESeanadCompositionPanel";

const OIREACHTAS_HERO = {
  // Interior of the Dáil Éireann chamber, Leinster House. Wikimedia Commons,
  // CC BY 4.0 (David Kernan). Host is whitelisted in next.config.
  image:
    "https://upload.wikimedia.org/wikipedia/commons/thumb/a/a8/Inside_the_D%C3%A1il_-_The_Irish_Parliament_Chamber.jpg/1280px-Inside_the_D%C3%A1il_-_The_Irish_Parliament_Chamber.jpg",
  alt: "The Dáil Éireann chamber, Leinster House, Dublin",
};

// The Seanad is shown for completeness — 43 senators are elected from vocational
// panels by an indirect electorate of councillors + outgoing TDs, 11 are nominated
// by the Taoiseach, and 6 by university graduates. Not part of the player
// legislative loop (per design doc §3.3). The cosmetic composition panel (Phase 8)
// is temporarily gated off pending further QA; the tab stays visible but is
// disabled so the IE legislature page stays Dáil-only for now.
const CHAMBER_OPTIONS = [
  { key: "dail", label: "Dáil" },
  {
    key: "seanad",
    label: "Seanad",
    disabled: true,
    title: "Seanad view temporarily disabled. The Dáil drives all player legislation.",
  },
];

type PageTab = "composition" | "bills" | "leadership" | "tariffs" | "subsidies";

// ─── Composition Tab ──────────────────────────────────────────────────────────

function CompositionTab({
  members,
  loading,
  activeChamber,
  countryId,
}: {
  members: MembersData | null;
  loading: boolean;
  activeChamber: string;
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

  const chamberLabel = activeChamber === "seanad" ? "Seanad Éireann" : "Dáil Éireann";

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
      parliamentChartVariant={activeChamber === "dail" ? "horseshoe" : "hemicycle"}
    />
  );
}

// ─── Bills Tab ────────────────────────────────────────────────────────────────

function BillsTab({
  bills,
  loading,
  activeChamber,
  countryId,
  onProposed,
}: {
  bills: BillsData | null;
  loading: boolean;
  activeChamber: string;
  countryId: CountryId;
  onProposed: () => void;
}) {
  const isDail = activeChamber === "dail";
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

  if (!isDail) {
    return (
      <div className="rounded-xl border border-card-border bg-card p-10 text-center">
        <p className="text-sm font-medium text-foreground">
          Seanad legislation is not player-managed.
        </p>
        <p className="mt-1 text-xs text-muted">
          The Seanad is partly elected by vocational panels and partly nominated; legislation flows
          through the Dáil.
        </p>
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
                ? "Admin — propose a Dáil bill"
                : "You are a seated TD — propose a bill"}
            </p>
            <p className="text-xs text-muted">
              Opens to a vote among seated Teachtaí Dála immediately.
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
          proposalWarning={proposalWarnings?.dail ?? null}
          chambers={[{ value: "dail", label: "Dáil Éireann" }]}
          domesticOnlyLabel="Irish-headquartered corporations only"
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
              <p className="text-sm font-medium text-foreground">Dissolve the Dáil</p>
              <p className="text-xs text-muted">
                As Taoiseach, you may call a snap election. All active legislation will fail.
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
          title="Taoiseach"
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
          The Taoiseach is nominated by the Dáil and leads the Government of Ireland. The Ceann
          Comhairle presides over the Dáil. The Opposition Leader heads the largest party not in the
          governing coalition.
        </p>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function IEOireachtasPage({ countryId }: { countryId: CountryId }) {
  const [activeChamber, setActiveChamber] = useState("dail");
  const { members, bills, leaders, loading, error, refetch } = useLegislatureData(
    countryId,
    activeChamber
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
      feature: "ie-oireachtas-government",
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

  const isDail = activeChamber === "dail";
  const totalSeats = isDail ? 160 : 60;
  const subtitle = isDail ? "160 TDs · PR-STV · Ireland" : "60 senators (advisory) · Ireland";

  // For Seanad (cosmetic chamber, no electedOfficials rows), bypass the
  // members-derived stats and show the fixed 60-seat totals + Taoiseach as the
  // appointing authority. The Composition tab renders the real breakdown.
  const majorityParty = isDail ? members?.composition[0] : null;
  const headerStats = {
    majorityParty: {
      name: majorityParty?.partyName ?? "—",
      color: majorityParty?.partyColor ?? "#888888",
      seats: majorityParty?.seats ?? 0,
    },
    totalSeats: isDail ? (members?.totalSeats ?? totalSeats) : totalSeats,
    leader: leaders?.primeMinister
      ? {
          label: isDail ? "Taoiseach" : "Appointing Taoiseach",
          name: leaders.primeMinister.characterName,
          id: leaders.primeMinister.characterId,
          sequentialId: leaders.primeMinister.sequentialId,
        }
      : null,
    minorityLeader:
      isDail && leaders?.oppositionLeader
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
            title={isDail ? "Dáil Éireann" : "Seanad Éireann"}
            subtitle={subtitle}
            heroImage={OIREACHTAS_HERO.image}
            heroAlt={OIREACHTAS_HERO.alt}
            stats={headerStats}
            chamberSwitcher={{
              active: activeChamber,
              onSwitch: (chamber) => {
                setActiveChamber(chamber);
                setActiveTab("bills");
              },
              options: CHAMBER_OPTIONS,
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

        {activeTab === "composition" &&
          (activeChamber === "seanad" ? (
            <IESeanadCompositionPanel />
          ) : (
            <CompositionTab
              members={members}
              loading={loading}
              activeChamber={activeChamber}
              countryId={countryId}
            />
          ))}
        {activeTab === "bills" && (
          <BillsTab
            bills={bills}
            loading={loading}
            activeChamber={activeChamber}
            countryId={countryId}
            onProposed={refetch}
          />
        )}
        {activeTab === "leadership" && (
          <LeadershipTab
            leaders={leaders}
            loading={loading}
            countryId={countryId}
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
