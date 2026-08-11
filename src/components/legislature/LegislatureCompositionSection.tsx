"use client";

import { useState, useEffect, useMemo, memo } from "react";
import Link from "next/link";
import {
  ParliamentChart,
  SeatBar,
  SeatLegend,
  MajorityBanner,
  type PartySeatsDisplay,
} from "@/components/ChamberChart";
import { WestminsterParliamentChart } from "@/components/WestminsterParliamentChart";
import { HorseshoeParliamentChart } from "@/components/HorseshoeParliamentChart";
import { PartyChip } from "@/app/congress/components/CongressShared";
import { Avatar } from "@/components/Avatar";
import type { LegislatureMember, LegislatureCompositionSectionProps } from "./types";
import { useCoalitionView, type CoalitionViewData } from "./useCoalitionView";
import type { CountryId } from "@/lib/constants/countries";

type MemberSortOption = "region" | "name" | "seats";

const ITEMS_PER_PAGE = 25;

const DEFAULT_SORT_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "region", label: "Region" },
  { value: "name", label: "Name" },
  { value: "seats", label: "Seats" },
];

const MemberListRow = memo(function MemberListRow({
  member,
  showSeats,
  leaderBadge,
}: {
  member: LegislatureMember;
  showSeats: boolean;
  leaderBadge?: string;
}) {
  return (
    <div className="flex items-center gap-3 py-3 px-4 border-b border-card-border/40 last:border-0 hover:bg-background/30 transition-colors">
      <Avatar url={member.avatarUrl ?? null} name={member.characterName} size="h-8 w-8" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <Link
            href={
              member.isNPP
                ? `/politicians/npp/${member.sequentialId ?? member.characterId}`
                : `/character/${member.sequentialId ?? member.characterId}`
            }
            title={member.characterName}
            className="text-sm font-medium text-primary underline hover:text-primary/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background rounded transition-colors"
          >
            {member.characterName}
          </Link>
          {member.isNPP && (
            <span className="rounded-full bg-card-border/60 px-2 py-0.5 text-[10px] text-muted">
              NPP
            </span>
          )}
          {leaderBadge && (
            <span
              className="inline-flex items-center rounded-md border border-warning/40 bg-warning/20 px-1.5 py-0.5 text-[10px] font-semibold text-warning uppercase tracking-wide"
              title={leaderBadge}
            >
              {leaderBadge}
            </span>
          )}
        </div>
        <div className="text-xs text-muted mt-0.5">
          <span className="font-medium">{member.region}</span>
        </div>
      </div>
      <PartyChip
        partyName={member.partyName}
        partyColor={member.partyColor}
        partyId={member.party}
        countryId={member.countryId}
      />
      {showSeats && (
        <span
          className="text-xs tabular-nums font-semibold shrink-0"
          style={{ color: member.partyColor }}
        >
          {member.seatsHeld} seat{member.seatsHeld !== 1 ? "s" : ""}
        </span>
      )}
    </div>
  );
});

export function LegislatureCompositionSection({
  data,
  chamberLabel,
  chamberSubtitle,
  showSeatsColumn,
  searchPlaceholder,
  sortOptions = DEFAULT_SORT_OPTIONS,
  defaultSort = "region",
  regionLabel = "Region",
  extraControls,
  filterFn,
  leaderBadges,
  countryId,
  parliamentChartVariant = "hemicycle",
  governmentContext,
}: LegislatureCompositionSectionProps) {
  const [sortBy, setSortBy] = useState<MemberSortOption>(defaultSort as MemberSortOption);
  const [searchQuery, setSearchQuery] = useState("");
  const [currentPage, setCurrentPage] = useState(1);

  // Reset to page 1 when filters/search change
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCurrentPage(1);
  }, [searchQuery, sortBy, filterFn]);

  const { members, composition, totalSeats, filledSeats } = data;

  const chartSeats: PartySeatsDisplay[] = useMemo(
    () =>
      composition.map((p) => ({
        party: p.party,
        partyName: p.partyName,
        partyColor: p.partyColor,
        economicPosition: p.economicPosition,
        seats: p.seats,
        countryId: p.countryId,
      })),
    [composition]
  );

  // Derive countryId from props or first composition entry
  const resolvedCountryId: CountryId | undefined =
    countryId ?? (data.composition[0]?.countryId as CountryId | undefined);

  // Coalition view
  const {
    loaded: coalitionsLoaded,
    hasCoalitionSeats,
    buildCoalitionView,
  } = useCoalitionView(resolvedCountryId);
  const [viewMode, setViewMode] = useState<"parties" | "coalitions">("parties");
  const showToggle = coalitionsLoaded && hasCoalitionSeats(chartSeats);
  const coalitionView: CoalitionViewData | null =
    viewMode === "coalitions" ? buildCoalitionView(chartSeats) : null;

  // Filter + sort memoized to avoid recomputing on unrelated re-renders
  const allSortedMembers = useMemo(() => {
    const searchLower = searchQuery.toLowerCase();
    const filtered = members.filter((m) => {
      if (filterFn && !filterFn(m)) return false;
      if (searchQuery) {
        const matchesName = m.characterName.toLowerCase().includes(searchLower);
        const matchesRegion = m.region.toLowerCase().includes(searchLower);
        const matchesParty = m.partyName.toLowerCase().includes(searchLower);
        return matchesName || matchesRegion || matchesParty;
      }
      return true;
    });

    return [...filtered].sort((a, b) => {
      switch (sortBy) {
        case "name":
          return a.characterName.localeCompare(b.characterName);
        case "region": {
          const regionCompare = a.region.localeCompare(b.region);
          if (regionCompare !== 0) return regionCompare;
          return a.characterName.localeCompare(b.characterName);
        }
        case "seats":
          return b.seatsHeld - a.seatsHeld;
        default:
          return 0;
      }
    });
  }, [members, searchQuery, sortBy, filterFn]);

  // Pagination
  const totalPages = Math.ceil(allSortedMembers.length / ITEMS_PER_PAGE);
  const validPage = Math.max(1, Math.min(currentPage, totalPages || 1));
  const paginatedMembers = allSortedMembers.slice(
    (validPage - 1) * ITEMS_PER_PAGE,
    validPage * ITEMS_PER_PAGE
  );

  const isEmpty = chartSeats.length === 0;
  const vacantCount = totalSeats - filledSeats;
  const subtitle = chamberSubtitle ?? `Current composition · ${totalSeats} total seats`;
  const placeholder = searchPlaceholder ?? `Search ${chamberLabel.toLowerCase()}...`;

  // Update regionLabel in sort options
  const resolvedSortOptions = sortOptions.map((opt) =>
    opt.value === "region" ? { ...opt, label: regionLabel } : opt
  );

  return (
    <div className="space-y-6">
      {/* Chart card */}
      <div className="rounded-xl border border-card-border bg-card p-5 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="font-semibold text-sm">{chamberLabel}</h2>
            <p className="text-xs text-muted mt-0.5">{subtitle}</p>
          </div>
          <div className="flex items-center gap-3">
            {showToggle && (
              <div className="flex rounded-lg border border-card-border overflow-hidden">
                <button
                  onClick={() => setViewMode("parties")}
                  className={`px-2.5 py-1 text-[11px] font-medium transition-colors ${
                    viewMode === "parties"
                      ? "bg-primary text-white"
                      : "bg-background text-muted hover:text-foreground"
                  }`}
                >
                  Parties
                </button>
                <button
                  onClick={() => setViewMode("coalitions")}
                  className={`px-2.5 py-1 text-[11px] font-medium transition-colors ${
                    viewMode === "coalitions"
                      ? "bg-primary text-white"
                      : "bg-background text-muted hover:text-foreground"
                  }`}
                >
                  Coalitions
                </button>
              </div>
            )}
            <span className="text-[10px] text-muted tabular-nums">{filledSeats} filled</span>
          </div>
        </div>
        {isEmpty ? (
          <div className="py-8 text-center space-y-3">
            <p className="text-sm font-medium text-muted">Waiting for elections to conclude</p>
            <p className="text-xs text-muted/70">Seats will appear once elections conclude.</p>
            <Link
              href="/elections"
              className="inline-block mt-3 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-white hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-primary transition-colors"
            >
              View Upcoming Elections →
            </Link>
          </div>
        ) : (
          <>
            {parliamentChartVariant === "westminster" && !coalitionView ? (
              <WestminsterParliamentChart
                seats={chartSeats}
                total={totalSeats}
                governmentContext={governmentContext}
              />
            ) : parliamentChartVariant === "horseshoe" && !coalitionView ? (
              <HorseshoeParliamentChart seats={chartSeats} total={totalSeats} />
            ) : (
              <ParliamentChart
                seats={chartSeats}
                total={totalSeats}
                coalitionView={coalitionView}
              />
            )}
            <SeatBar seats={chartSeats} total={totalSeats} />
            {showToggle && (
              <SeatBar
                seats={chartSeats}
                total={totalSeats}
                coalitionView={buildCoalitionView(chartSeats)}
              />
            )}
            <SeatLegend seats={chartSeats} total={totalSeats} coalitionView={coalitionView} />
            <MajorityBanner seats={chartSeats} total={totalSeats} chamberLabel={chamberLabel} />
          </>
        )}
      </div>

      {/* Filters and sort controls */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-xs">
          <input
            type="text"
            placeholder={placeholder}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            aria-label={`Search by name, ${regionLabel.toLowerCase()}, or party`}
            className="w-full rounded-lg border border-card-border bg-card px-3 py-1.5 text-sm placeholder:text-muted focus:outline-none focus:border-primary focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          />
        </div>

        {extraControls}

        <div className="flex items-center gap-2 ml-auto">
          <label htmlFor="legislature-sort-select" className="text-xs text-muted">
            Sort by:
          </label>
          <select
            id="legislature-sort-select"
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as MemberSortOption)}
            aria-label="Sort members"
            className="rounded-lg border border-card-border bg-card px-3 py-1.5 text-sm focus:outline-none focus:border-primary focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            {resolvedSortOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Member list */}
      {allSortedMembers.length === 0 ? (
        <div className="rounded-xl border border-card-border bg-card p-12 text-center">
          <p className="text-sm text-muted">No members found.</p>
        </div>
      ) : (
        <div className="rounded-xl border border-card-border bg-card overflow-hidden">
          <div className="px-4 py-3 border-b border-card-border bg-background/40">
            <h2 className="text-sm font-semibold">
              Members
              <span className="ml-2 text-xs font-normal text-muted">
                {allSortedMembers.length} seated
                {totalPages > 1 && ` (page ${validPage} of ${totalPages})`}
                {vacantCount > 0 && <span className="ml-1 text-muted">· {vacantCount} vacant</span>}
              </span>
            </h2>
          </div>
          <div className="divide-y divide-card-border/40">
            {paginatedMembers.map((member) => (
              <MemberListRow
                key={member.id}
                member={member}
                showSeats={showSeatsColumn}
                leaderBadge={member.characterId ? leaderBadges?.get(member.characterId) : undefined}
              />
            ))}
          </div>
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-card-border/40 bg-background/40 text-sm">
              <button
                onClick={() => setCurrentPage(Math.max(1, validPage - 1))}
                disabled={validPage === 1}
                aria-label={`Go to previous page (page ${Math.max(1, validPage - 1)} of ${totalPages})`}
                className="rounded-lg border border-card-border bg-card px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed hover:enabled:text-foreground focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:focus-visible:ring-offset-0"
              >
                ← Previous
              </button>
              <span className="text-xs text-muted" aria-live="polite">
                Page {validPage} of {totalPages}
              </span>
              <button
                onClick={() => setCurrentPage(Math.min(totalPages, validPage + 1))}
                disabled={validPage === totalPages}
                aria-label={`Go to next page (page ${Math.min(totalPages, validPage + 1)} of ${totalPages})`}
                className="rounded-lg border border-card-border bg-card px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed hover:enabled:text-foreground focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:focus-visible:ring-offset-0"
              >
                Next →
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
