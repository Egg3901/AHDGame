"use client";

import { useState } from "react";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { LegislatureCompositionSection } from "@/components/legislature/LegislatureCompositionSection";
import type { LegislatureCompositionData, LegislatureMember } from "@/components/legislature/types";
import type { BillDisplay } from "@/lib/legislature/dto/billDisplay";
import { BillsList } from "@/components/bills/BillsList";
import { BillListControls, type BillVoteFilter } from "@/components/bills/BillListControls";
import { ProposeLegislationModal } from "./ProposeLegislationModal";
import {
  matchesLegislatureBillStatusFilter,
  type LegislatureBillStatusFilter,
} from "@/lib/legislature/billStatusFilters";
import LegislatureHeader from "./components/shared/LegislatureHeader";
import { NgChamberLeadershipPanel } from "./NgChamberLeadershipPanel";
import {
  useLegislatureData,
  type MembersData,
  type BillsData,
} from "./components/shared/useLegislatureData";

const NATIONAL_ASSEMBLY_HERO = {
  image: "/api/images/hero/national-assembly",
  alt: "The National Assembly Complex, Abuja",
};

const LEGISLATURE_STATUS_FILTERS = [
  { value: "all", label: "All" },
  { value: "voting", label: "Voting" },
  { value: "passed", label: "Passed" },
  { value: "failed", label: "Failed" },
] satisfies Array<{ value: LegislatureBillStatusFilter; label: string }>;

type ChamberKey = "house" | "senate";
type PageTab = "composition" | "bills" | "leadership";

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

  const data: LegislatureCompositionData = {
    members: members.members.map((m): LegislatureMember => ({
      id: m.characterId || `npp-${m.party}-${m.constituency}`,
      characterId: m.characterId,
      sequentialId: m.sequentialId ?? null,
      characterName: m.characterName,
      region: m.constituency,
      party: m.party,
      partyName: m.partyName,
      partyColor: m.partyColor,
      countryId,
      seatsHeld: m.seatsHeld,
      isNPP: m.isNPP,
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
      data={data}
      chamberLabel={chamberLabel}
      showSeatsColumn={true}
      regionLabel="Zone"
      searchPlaceholder="Search parties…"
      countryId={countryId}
    />
  );
}

// ─── Bills Tab ────────────────────────────────────────────────────────────────

function BillsTab({
  bills,
  loading,
  countryId,
  activeChamber,
  chamberShortName,
  onProposed,
}: {
  bills: BillsData | null;
  loading: boolean;
  countryId: CountryId;
  activeChamber: ChamberKey;
  chamberShortName: string;
  onProposed: () => void;
}) {
  const [showModal, setShowModal] = useState(false);
  const [voteFilter, setVoteFilter] = useState<BillVoteFilter>("all");
  const [statusFilter, setStatusFilter] = useState<LegislatureBillStatusFilter>("all");

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
  const filtered = billList.filter((bill: BillDisplay) => {
    if (!matchesLegislatureBillStatusFilter(bill.status, statusFilter)) return false;
    if (voteFilter === "voted") return bill.myVote != null;
    if (voteFilter === "not_voted") return bill.myVote == null;
    return true;
  });

  return (
    <div className="space-y-4">
      {(canPropose || hasActiveBill) && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-primary/20 bg-primary/5 px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-foreground">
              {adminOverride
                ? "Admin — propose a bill"
                : "You are a seated member — propose a bill"}
            </p>
            <p className="text-xs text-muted">Opens to a vote among seated members immediately.</p>
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
        statusFilter={statusFilter}
        statusFilterOptions={LEGISLATURE_STATUS_FILTERS}
        onStatusFilterChange={(filter) => setStatusFilter(filter as LegislatureBillStatusFilter)}
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
          proposalWarning={proposalWarnings?.[activeChamber] ?? null}
          chambers={[{ value: activeChamber, label: chamberShortName }]}
          domesticOnlyLabel="Nigeria-headquartered corporations only"
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

function LeadershipTab({ countryId }: { countryId: CountryId }) {
  return (
    <div className="space-y-6">
      <NgChamberLeadershipPanel countryId={countryId} />
      <div className="rounded-xl border border-card-border/40 bg-card-muted/30 p-4">
        <p className="text-xs text-muted leading-relaxed">
          Presiding officers are elected by the members of their respective chambers. When an
          election is open, seated members can declare and vote here.
        </p>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function NGAssemblyPage({ countryId }: { countryId: CountryId }) {
  const [activeChamber, setActiveChamber] = useState<ChamberKey>("house");
  const [activeTab, setActiveTab] = useState<PageTab>("composition");
  const { members, bills, loading, error, refetch } = useLegislatureData(countryId, activeChamber);

  const config = COUNTRY_CONFIGS[countryId];
  const lower = config.legislature.lowerChamber;
  const upper = config.legislature.upperChamber!;
  const chamberConfig = activeChamber === "house" ? lower : upper;

  const majorityParty = members?.composition[0];
  const headerStats = {
    majorityParty: {
      name: majorityParty?.partyName ?? "—",
      color: majorityParty?.partyColor ?? "#888888",
      seats: majorityParty?.seats ?? 0,
    },
    totalSeats: members?.totalSeats ?? chamberConfig.seats,
    leader: null,
    minorityLeader: null,
  };

  const TABS: { id: PageTab; label: string }[] = [
    { id: "composition", label: "Composition" },
    { id: "bills", label: "Bills" },
    { id: "leadership", label: "Leadership" },
  ];

  return (
    <div className="min-h-screen bg-background">
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        {loading ? (
          <div className="mb-5 h-[220px] rounded-2xl bg-card/60 animate-pulse" />
        ) : (
          <LegislatureHeader
            countryId={countryId}
            title={config.legislature.name}
            subtitle={`${chamberConfig.seats.toLocaleString("en-US")} seats · ${chamberConfig.description}`}
            heroImage={NATIONAL_ASSEMBLY_HERO.image}
            heroAlt={NATIONAL_ASSEMBLY_HERO.alt}
            stats={headerStats}
            chamberSwitcher={{
              active: activeChamber,
              onSwitch: (chamber) => {
                setActiveChamber(chamber as ChamberKey);
                setActiveTab("composition");
              },
              options: [
                { key: "house", label: lower.shortName },
                { key: "senate", label: upper.shortName },
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
        </div>

        {activeTab === "composition" && (
          <CompositionTab
            members={members}
            loading={loading}
            chamberLabel={chamberConfig.name}
            countryId={countryId}
          />
        )}
        {activeTab === "bills" && (
          <BillsTab
            bills={bills}
            loading={loading}
            countryId={countryId}
            activeChamber={activeChamber}
            chamberShortName={chamberConfig.shortName}
            onProposed={refetch}
          />
        )}
        {activeTab === "leadership" && <LeadershipTab countryId={countryId} />}
      </main>
    </div>
  );
}
