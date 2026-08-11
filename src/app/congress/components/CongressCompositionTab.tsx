"use client";

import { LegislatureCompositionSection } from "@/components/legislature/LegislatureCompositionSection";
import type { LegislatureCompositionData, LegislatureMember } from "@/components/legislature/types";
import type { CongressMembersResponse } from "@/lib/congress/types";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { LEADER_BADGE_SHORT, getSenateClassLabel } from "./CongressConstants";
import type { ChamberTab, SenateClassFilter, LeaderStrip } from "./CongressConstants";

export type LeaderForBadge = {
  role: string;
  label: string;
  chamber: "house" | "senate";
  characterId: string | null;
};

function mapToCompositionData(
  data: CongressMembersResponse | null,
  countryId: CountryId
): LegislatureCompositionData {
  if (!data) {
    return { members: [], composition: [], totalSeats: 0, filledSeats: 0 };
  }

  const members: LegislatureMember[] = data.members.map((m) => ({
    id: m.id,
    characterId: m.characterId,
    sequentialId: m.sequentialId,
    characterName: m.characterName,
    avatarUrl: m.avatarUrl,
    region: m.state,
    party: m.party,
    partyName: m.partyName,
    partyColor: m.partyColor,
    countryId: m.countryId,
    seatsHeld: m.seatsHeld,
    isNPP: m.isNPP,
    isVacant: m.isVacant,
  }));

  const composition = data.composition.map((c) => ({
    party: c.party,
    partyName: c.partyName,
    partyColor: c.partyColor,
    economicPosition: c.economicPosition,
    seats: c.seats,
    countryId,
  }));

  return {
    members,
    composition,
    totalSeats: data.totalSeats,
    filledSeats: data.members.reduce((sum, m) => sum + m.seatsHeld, 0),
  };
}

function SenateClassFilterControls({
  senateClassFilter,
  setSenateClassFilter,
}: {
  senateClassFilter: SenateClassFilter;
  setSenateClassFilter: (v: SenateClassFilter) => void;
}) {
  return (
    <div className="flex items-center gap-2 overflow-x-auto">
      <span
        className="text-xs text-muted cursor-help whitespace-nowrap"
        title="Senate classes determine election cycles. Class I, II, and III each have ~33 seats. About 1/3 of the Senate runs for reelection every 2 years. Senators serve 6-year terms."
      >
        Filter by class:
      </span>
      <div className="flex rounded-lg border border-card-border overflow-hidden text-sm">
        {([0, 1, 2, 3] as SenateClassFilter[]).map((cls) => {
          const tooltips: Record<number, string> = {
            0: "Show all senate members",
            1: "Class I: ~33 senators (elected in cycles 0, 3, 6...)",
            2: "Class II: ~33 senators (elected in cycles 1, 4, 7...)",
            3: "Class III: ~34 senators (elected in cycles 2, 5, 8...)",
          };
          const isSelected = senateClassFilter === cls;
          return (
            <button
              key={cls}
              aria-pressed={isSelected}
              title={tooltips[cls]}
              onClick={() => setSenateClassFilter(cls)}
              className={`px-3 py-1.5 font-medium transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary ${
                isSelected
                  ? "bg-secondary/20 text-foreground border border-secondary/40"
                  : "bg-card text-muted hover:text-foreground focus-visible:-ring-offset-2"
              }`}
            >
              {cls === 0 ? "All" : `Class ${getSenateClassLabel(cls)}`}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function CongressCompositionTab({
  activeTab,
  senateData,
  houseData,
  senateClassFilter,
  setSenateClassFilter,
  leaders,
  countryId,
}: {
  activeTab: ChamberTab;
  senateData: CongressMembersResponse | null;
  houseData: CongressMembersResponse | null;
  senateClassFilter: SenateClassFilter;
  setSenateClassFilter: (v: SenateClassFilter) => void;
  leaders: LeaderStrip[];
  countryId: CountryId;
}) {
  const data = activeTab === "senate" ? senateData : houseData;
  const compositionData = mapToCompositionData(data, countryId);
  const total = activeTab === "senate" ? 100 : 435;

  // Override totalSeats to the canonical value
  compositionData.totalSeats = total;

  const chamberLeaders = (leaders ?? []).filter((l) => l.chamber === activeTab && l.characterId);
  const leaderBadges = new Map<string, string>(
    chamberLeaders.map((l) => [l.characterId!, LEADER_BADGE_SHORT[l.role] ?? l.label])
  );

  const chamberLabel =
    activeTab === "senate"
      ? COUNTRY_CONFIGS.US.legislature.upperChamber!.name
      : COUNTRY_CONFIGS.US.legislature.lowerChamber.name;

  // Senate class filter — uses the original CongressMember data for senateClass field
  const senateClassMap = new Map(
    (data?.members ?? []).filter((m) => m.senateClass).map((m) => [m.id, m.senateClass!])
  );

  const filterFn =
    activeTab === "senate" && senateClassFilter !== 0
      ? (member: LegislatureMember) => senateClassMap.get(member.id) === senateClassFilter
      : undefined;

  return (
    <LegislatureCompositionSection
      data={compositionData}
      chamberLabel={chamberLabel}
      showSeatsColumn={activeTab === "house"}
      searchPlaceholder={`Search ${activeTab === "senate" ? "senators" : "representatives"}...`}
      regionLabel="State"
      defaultSort="region"
      countryId="US"
      extraControls={
        activeTab === "senate" ? (
          <SenateClassFilterControls
            senateClassFilter={senateClassFilter}
            setSenateClassFilter={setSenateClassFilter}
          />
        ) : undefined
      }
      filterFn={filterFn}
      leaderBadges={leaderBadges}
    />
  );
}
