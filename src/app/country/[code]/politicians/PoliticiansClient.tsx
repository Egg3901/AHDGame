"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import Link from "next/link";
import { useParams } from "next/navigation";
import { getPartyLabel } from "@/lib/utils/politics";
import { ladderWidthPct } from "@/lib/politicians/ladder";
import { Avatar } from "@/components/Avatar";
import { Skeleton } from "@/components/ui";
import { formatPartyCountryMoney } from "@/lib/utils/formatters";
import { PartyChip } from "@/app/congress/components/CongressShared";
import { politiciansApiUrl } from "@/lib/urls";
import type { PoliticianData } from "@/lib/politicians/types";

interface Props {
  initialPoliticians: PoliticianData[];
  initialStats: { playerCount: number; nppCount: number };
}

type SortOption = "npi" | "favorability" | "funds" | "office" | "name" | "party";
type OfficeFilter = "all" | "federal_exec" | "congress" | "state" | "citizen";

function getOfficeFilters(countryCode: string): { value: OfficeFilter; label: string }[] {
  const cid = countryCode.toUpperCase() as CountryId;
  const config = COUNTRY_CONFIGS[cid];
  const legislatureName = config?.legislature?.name ?? "Congress";
  const isUS = cid === "US";
  const subNationalLabel = isUS ? "State" : "Region";
  return [
    { value: "all", label: "All Offices" },
    { value: "federal_exec", label: "Executive" },
    { value: "congress", label: legislatureName },
    { value: "state", label: subNationalLabel },
    { value: "citizen", label: "Citizen" },
  ];
}

/** Higher = more senior office. Used for sort-by-position. */
function getOfficeRank(officeType: string | null): number {
  switch (officeType) {
    case "president":
    case "primeMinister":
    // IE Uachtarán is head of state — same tier as US president / UK PM.
    case "uachtaran":
      return 0;
    case "vicePresident":
      return 1;
    case "senate":
    case "sangiin":
    // IE Seanad — upper-chamber tier.
    case "seanad":
      return 2;
    case "governor":
    case "ministerPresident":
      return 3;
    case "house":
    case "commons":
    case "shugiin":
    case "bundestag":
    // IE Dáil — lower-chamber tier.
    case "dail":
      return 4;
    case "stateSenate":
    case "regionalCouncil":
    case "landtag":
    case "peoplesCongress":
    // IE Local Council — sub-national chamber tier.
    case "localCouncil":
      return 5;
    case "npcDelegate":
      return 4;
    default:
      return 6; // Private Citizen
  }
}

function getFavClass(fav: number): string {
  if (fav >= 60) return "text-success";
  if (fav >= 40) return "text-warning";
  return "text-error";
}

const SELECT_CLASS =
  "rounded-lg border border-card-border bg-background/50 px-3 py-1.5 text-xs font-medium focus:border-primary/60 focus:outline-none transition-all cursor-pointer hover:bg-card-elevated";

export default function PoliticiansClient({ initialPoliticians, initialStats }: Props) {
  const { code } = useParams<{ code: string }>();
  const [politicians, setPoliticians] = useState<PoliticianData[]>(initialPoliticians);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [sortBy, setSortBy] = useState<SortOption>("npi");
  const [hideNPPs, setHideNPPs] = useState(true);
  const [partyFilter, setPartyFilter] = useState("all");
  const [officeFilter, setOfficeFilter] = useState<OfficeFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [stats, setStats] = useState(initialStats);

  // Skip the first fetch — server already provided initial data.
  // Re-fetch only when the user switches country.
  const isInitialRender = useRef(true);

  const effectiveCountry = code?.toLowerCase() ?? "us";

  // Build a map from party sequentialId to party name
  const partyNameMap = useMemo(() => {
    const map = new Map<string, string>();
    politicians.forEach((p) => {
      if (p.partyName && !map.has(p.party)) {
        map.set(p.party, p.partyName);
      }
    });
    return map;
  }, [politicians]);

  const partyOptions = useMemo(() => {
    const seen = new Set<string>();
    politicians.forEach((p) => seen.add(p.party));
    // Sort by party name for better UX
    const sorted = [...seen].sort((a, b) => {
      const nameA = partyNameMap.get(a) ?? getPartyLabel(a);
      const nameB = partyNameMap.get(b) ?? getPartyLabel(b);
      return nameA.localeCompare(nameB);
    });
    return ["all", ...sorted];
  }, [politicians, partyNameMap]);

  useEffect(() => {
    if (isInitialRender.current) {
      isInitialRender.current = false;
      return;
    }
    const fetchPoliticians = async () => {
      try {
        setLoading(true);
        const res = await fetch(politiciansApiUrl(effectiveCountry));
        const data = await res.json();
        if (res.ok) {
          setPoliticians(data.politicians);
          setStats({ playerCount: data.playerCount, nppCount: data.nppCount });
        } else {
          setError(data.error || "Failed to fetch politicians");
        }
      } catch {
        setError("Network error - please try again");
      } finally {
        setLoading(false);
      }
    };
    fetchPoliticians();
  }, [effectiveCountry]);

  const filteredPoliticians = useMemo(() => {
    return politicians.filter((p) => {
      if (hideNPPs && p.isNPP) return false;

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        if (!p.name.toLowerCase().includes(q) && !p.homeStateName.toLowerCase().includes(q))
          return false;
      }

      if (partyFilter !== "all") {
        if (p.party.toLowerCase() !== partyFilter.toLowerCase()) return false;
      }

      if (officeFilter !== "all") {
        const type = p.officeType;
        switch (officeFilter) {
          case "federal_exec":
            if (
              !type ||
              !["president", "vicePresident", "primeMinister", "taoiseach", "uachtaran"].includes(
                type
              )
            )
              return false;
            break;
          case "congress":
            if (
              !type ||
              ![
                "senate",
                "house",
                "commons",
                "shugiin",
                "sangiin",
                "bundestag",
                "dail",
                "seanad",
              ].includes(type)
            )
              return false;
            break;
          case "state":
            if (
              !type ||
              ![
                "governor",
                "stateSenate",
                "regionalCouncil",
                "landtag",
                "ministerPresident",
                "peoplesCongress",
                "localCouncil",
              ].includes(type)
            )
              return false;
            break;
          case "citizen":
            if (type !== null) return false;
            break;
        }
      }

      return true;
    });
  }, [politicians, hideNPPs, searchQuery, partyFilter, officeFilter]);

  const sortedPoliticians = useMemo(() => {
    return [...filteredPoliticians].sort((a, b) => {
      switch (sortBy) {
        case "name":
          return a.name.localeCompare(b.name);
        case "npi":
          return (
            b.nationalInfluence - a.nationalInfluence || b.politicalInfluence - a.politicalInfluence
          );
        case "favorability":
          return b.favorability - a.favorability || b.nationalInfluence - a.nationalInfluence;
        case "funds":
          // NPPs have null funds — push them to the bottom
          return (b.funds ?? -1) - (a.funds ?? -1);
        case "office":
          return (
            getOfficeRank(a.officeType) - getOfficeRank(b.officeType) ||
            b.politicalInfluence - a.politicalInfluence
          );
        case "party":
          return a.party.localeCompare(b.party) || b.politicalInfluence - a.politicalInfluence;
        default:
          return 0;
      }
    });
  }, [filteredPoliticians, sortBy]);

  const maxNPI = useMemo(() => {
    if (sortedPoliticians.length === 0) return 1;
    return Math.max(...sortedPoliticians.map((p) => p.nationalInfluence), 1);
  }, [sortedPoliticians]);

  const isRankedSort = sortBy === "npi" || sortBy === "favorability" || sortBy === "funds";
  const showFunds = sortBy === "funds";

  const hasActiveFilters =
    !hideNPPs || partyFilter !== "all" || officeFilter !== "all" || searchQuery.trim() !== "";

  function resetFilters() {
    setHideNPPs(true);
    setPartyFilter("all");
    setOfficeFilter("all");
    setSearchQuery("");
  }

  return (
    <div className="min-h-screen bg-background pb-16">
      <main className="mx-auto max-w-7xl px-4 sm:px-6 py-8 overflow-x-hidden">
        {/* Compact header — operational page, no hero (density rule). */}
        <header className="mb-5 flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h1 className="text-heading-lg font-extrabold tracking-tight">Politicians</h1>
            <span className="font-mono text-body-sm text-muted">
              {sortedPoliticians.length} of {politicians.length}
            </span>
            <span className="font-mono text-body-xs text-muted/70">
              {stats.playerCount} players · {stats.nppCount} NPPs
            </span>
          </div>
          <div className="relative w-full max-w-xs sm:w-72">
            <svg
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z"
              />
            </svg>
            <input
              type="text"
              placeholder="Search by name or location…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full rounded-lg border border-card-border bg-card py-2 pl-9 pr-9 text-sm placeholder:text-muted focus:border-primary/60 focus:outline-none focus:ring-1 focus:ring-primary/20 transition-all"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted transition-colors hover:text-foreground"
                aria-label="Clear search"
              >
                <svg
                  className="h-4 w-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        </header>

        {/* Consolidated toolbar (locked composite) — one row of dropdowns +
            the gold Players-only switch; sticky for long lists. */}
        <div className="sticky top-20 z-30 mb-5 flex flex-wrap items-center gap-2.5 rounded-xl border border-card-border bg-card/95 px-3.5 py-2.5 shadow-card backdrop-blur supports-[backdrop-filter]:bg-card/80">
          <label className="sr-only" htmlFor="politicians-party-filter">
            Party
          </label>
          <select
            id="politicians-party-filter"
            value={partyFilter}
            onChange={(e) => setPartyFilter(e.target.value)}
            className={SELECT_CLASS}
          >
            {partyOptions.map((party) => (
              <option key={party} value={party}>
                {party === "all"
                  ? "All Parties"
                  : (partyNameMap.get(party) ?? getPartyLabel(party))}
              </option>
            ))}
          </select>
          <label className="sr-only" htmlFor="politicians-office-filter">
            Office
          </label>
          <select
            id="politicians-office-filter"
            value={officeFilter}
            onChange={(e) => setOfficeFilter(e.target.value as OfficeFilter)}
            className={SELECT_CLASS}
          >
            {getOfficeFilters(effectiveCountry).map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
          <label className="sr-only" htmlFor="politicians-sort">
            Sort
          </label>
          <select
            id="politicians-sort"
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortOption)}
            className={SELECT_CLASS}
          >
            <option value="npi">Sort: National Influence</option>
            <option value="favorability">Sort: Favorability</option>
            <option value="funds">Sort: Campaign Funds</option>
            <option value="office">Sort: Office Rank</option>
            <option value="name">Sort: Name (A–Z)</option>
            <option value="party">Sort: Party</option>
          </select>
          {hasActiveFilters && (
            <button
              onClick={resetFilters}
              className="text-xs text-primary transition-colors hover:text-primary-dark hover:underline"
            >
              Clear filters
            </button>
          )}
          <span className="flex-1" />
          <button
            onClick={() => setHideNPPs((v) => !v)}
            aria-pressed={hideNPPs}
            className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold transition-all ${
              hideNPPs
                ? "border-gold/45 bg-gold/10 text-gold"
                : "border-card-border bg-background/50 text-muted hover:border-gold/30 hover:text-foreground"
            }`}
          >
            <span
              className={`relative h-3.5 w-7 rounded-full transition-colors ${
                hideNPPs ? "bg-gold/35" : "bg-track"
              }`}
              aria-hidden
            >
              <span
                className={`absolute top-0.5 h-2.5 w-2.5 rounded-full transition-all ${
                  hideNPPs ? "right-0.5 bg-gold" : "left-0.5 bg-muted"
                }`}
              />
            </span>
            Players only
          </button>
        </div>

        {/* Error */}
        {error && (
          <div className="mb-8 flex items-center gap-2 rounded-xl border border-error/30 bg-error/10 p-4 text-sm text-error">
            <svg className="h-5 w-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
            {error}
          </div>
        )}

        {/* Loading */}
        {loading && !error && (
          <div className="overflow-hidden rounded-xl border border-card-border bg-card">
            {Array.from({ length: 10 }).map((_, i) => (
              <div
                key={i}
                className="flex items-center gap-4 border-b border-card-border/50 px-4 py-3 last:border-b-0"
              >
                <Skeleton className="h-9 w-9 shrink-0 rounded-lg" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-3.5 w-1/3" />
                  <Skeleton className="h-2.5 w-1/4" />
                </div>
                <Skeleton className="h-2 w-28" />
              </div>
            ))}
          </div>
        )}

        {/* Ranked list — S ladder rows + B's dedicated Office column. */}
        {!loading && !error && (
          <>
            {sortedPoliticians.length === 0 ? (
              <div className="flex flex-col items-center justify-center rounded-2xl border border-card-border bg-card p-16 text-center shadow-card">
                <h3 className="text-heading-sm font-semibold text-foreground">
                  No politicians found
                </h3>
                <p className="mx-auto mt-1 max-w-sm text-muted">
                  We couldn&apos;t find any politicians matching your current filters. Try adjusting
                  your search criteria.
                </p>
                <button
                  onClick={resetFilters}
                  className="mt-6 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary/90"
                >
                  Clear All Filters
                </button>
              </div>
            ) : (
              <div className="overflow-hidden rounded-xl border border-card-border bg-card">
                {/* Column headers */}
                <div className="grid grid-cols-[2.5rem_minmax(0,1.5fr)_8.5rem_5.5rem] items-center gap-3.5 border-b border-card-border bg-card-muted px-4 py-2 text-[9px] font-bold uppercase tracking-widest text-muted lg:grid-cols-[2.75rem_minmax(0,1.5fr)_9rem_minmax(0,1fr)_8.5rem_5.5rem]">
                  <span className="text-right">#</span>
                  <span>Name</span>
                  <span className="hidden lg:block">Party</span>
                  <span className="hidden lg:block">Office</span>
                  <span>Influence</span>
                  <span className="text-right">{showFunds ? "Funds" : "Favorability"}</span>
                </div>
                {sortedPoliticians.map((politician, index) => {
                  const leader = isRankedSort && index === 0;
                  return (
                    <Link
                      key={politician.id}
                      href={
                        politician.isNPP
                          ? `/politicians/npp/${politician.id}`
                          : `/character/${politician.sequentialId ?? politician.id}`
                      }
                      className="grid grid-cols-[2.5rem_minmax(0,1.5fr)_8.5rem_5.5rem] items-center gap-3.5 border-b border-card-border/50 px-4 py-2.5 transition-colors last:border-b-0 hover:bg-card-elevated/40 lg:grid-cols-[2.75rem_minmax(0,1.5fr)_9rem_minmax(0,1fr)_8.5rem_5.5rem]"
                    >
                      {/* Rank */}
                      <span
                        className={`text-right font-mono text-sm font-semibold tabular-nums ${
                          leader ? "text-gold" : isRankedSort ? "text-muted" : "text-muted/50"
                        }`}
                      >
                        {isRankedSort || sortBy === "office" ? index + 1 : "·"}
                      </span>

                      {/* Name + badges + location subline (party·office fold in below lg) */}
                      <span className="flex min-w-0 items-center gap-2.5">
                        <Avatar
                          url={politician.avatarUrl}
                          name={politician.name}
                          size="h-9 w-9"
                          className="shrink-0 rounded-lg"
                        />
                        <span className="min-w-0">
                          <span className="flex items-center gap-1.5">
                            <span className="truncate text-sm font-bold text-foreground">
                              {politician.name}
                            </span>
                            {!politician.isNPP && (
                              <span className="shrink-0 rounded-full border border-gold/40 bg-gold/10 px-1.5 py-px text-[8px] font-bold tracking-wider text-gold">
                                PLAYER
                              </span>
                            )}
                            {politician.isAdmin && (
                              <span className="shrink-0 rounded-full border border-warning/30 bg-warning/10 px-1.5 py-px text-[8px] font-bold uppercase tracking-wider text-warning">
                                Admin
                              </span>
                            )}
                            {politician.isModerator && !politician.isAdmin && (
                              <span className="shrink-0 rounded-full border border-info/30 bg-info/10 px-1.5 py-px text-[8px] font-bold uppercase tracking-wider text-info">
                                Moderator
                              </span>
                            )}
                          </span>
                          <span className="block truncate text-[11px] text-muted">
                            {politician.homeStateName}
                            <span className="lg:hidden">
                              {" · "}
                              {politician.partyName ?? getPartyLabel(politician.party)}
                              {politician.currentOffice ? ` · ${politician.currentOffice}` : ""}
                            </span>
                          </span>
                        </span>
                      </span>

                      {/* Party (own column ≥lg) */}
                      <span className="hidden min-w-0 lg:block">
                        <PartyChip
                          partyName={politician.partyName ?? getPartyLabel(politician.party)}
                          partyColor={politician.partyColor ?? "#888888"}
                          partyId={politician.party}
                          countryId={politician.countryId}
                        />
                      </span>

                      {/* Office (own column ≥lg, from B) */}
                      <span className="hidden truncate text-[13px] font-semibold text-foreground/90 lg:block">
                        {politician.currentOffice || (
                          <span className="font-normal italic text-muted">Private citizen</span>
                        )}
                      </span>

                      {/* NPI rank ladder */}
                      <span className="min-w-0">
                        <span className="mb-1 flex items-baseline justify-between font-mono text-[10px] text-muted">
                          <span>NPI</span>
                          <span className="font-semibold text-foreground">
                            {politician.nationalInfluence.toFixed(1)}
                          </span>
                        </span>
                        <span className="block h-1 rounded-full bg-track">
                          <span
                            className={`block h-1 rounded-full ${leader ? "bg-gold" : "bg-muted"}`}
                            style={{
                              width: `${ladderWidthPct(politician.nationalInfluence, maxNPI)}%`,
                            }}
                          />
                        </span>
                      </span>

                      {/* Favorability (or funds when sorting by funds) */}
                      <span
                        className={`text-right font-mono text-xs tabular-nums ${
                          showFunds ? "text-success" : getFavClass(politician.favorability)
                        }`}
                      >
                        {showFunds
                          ? politician.funds !== null
                            ? formatPartyCountryMoney(politician.funds, politician.countryId)
                            : "—"
                          : `${politician.favorability.toFixed(0)}%`}
                      </span>
                    </Link>
                  );
                })}
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
