"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { UK_NATIONS, UK_REGIONS, getUKCouncilName } from "@/lib/constants/uk";
import { regionUrl, regionApiSubUrl } from "@/lib/urls";
import {
  COUNTRY_CONFIGS,
  getSubNationalLegislatureKey,
  isParliamentarySystem,
  type CountryId,
} from "@/lib/constants/countries";
import type { BillChamber } from "@/lib/db/types/legislation";
import { LegislatureData, StateBillDisplay } from "./legislatureTypes";
import { BillsTab } from "./components/BillsTab";
import { LegislatureCompositionSection } from "@/components/legislature/LegislatureCompositionSection";
import { CardSkeleton, ListRowSkeleton, Skeleton } from "@/components/ui";
import type { LegislatureCompositionData, LegislatureMember } from "@/components/legislature/types";

type TabId = "composition" | "bills";

function mapToCompositionData(
  data: LegislatureData,
  totalSeats: number
): LegislatureCompositionData {
  const sortedParties = Object.entries(data.composition).sort((a, b) => b[1].seats - a[1].seats);

  const composition = sortedParties.map(([partyId, party]) => ({
    party: partyId,
    partyName: party.name,
    partyColor: party.color,
    economicPosition: party.economicPosition,
    seats: party.seats,
    countryId: party.countryId as "US" | "UK" | "DE" | undefined,
  }));

  const members: LegislatureMember[] = data.officials.map((o) => ({
    id: o.id,
    characterId: o.characterId ?? null,
    sequentialId: o.sequentialId ?? null,
    characterName: o.characterName ?? "Unknown",
    avatarUrl: o.avatarUrl,
    region: data.state.name,
    party: o.party ?? "independent",
    partyName: o.partyName ?? o.party ?? "Independent",
    partyColor: o.partyColor ?? "#6b7280",
    countryId: (o.countryId ?? "US") as "US" | "UK" | "DE",
    seatsHeld: o.seatsHeld,
    isNPP: o.isNPP,
    isVacant: false,
  }));

  return {
    members,
    composition,
    totalSeats,
    filledSeats: data.state.filledSeats,
  };
}

export function StateLegislatureClient({
  stateId,
  countryId,
  stateName,
  totalSeats,
  isLoggedIn: _isLoggedIn,
  characterId,
  isAdmin = false,
}: {
  stateId: string;
  countryId: string;
  stateName: string;
  totalSeats: number;
  isLoggedIn: boolean;
  characterId?: string;
  isAdmin?: boolean;
}) {
  const [activeTab, setActiveTab] = useState<TabId>("bills");
  const [data, setData] = useState<LegislatureData | null>(null);
  const [bills, setBills] = useState<StateBillDisplay[]>([]);
  const [blockedProvisions, setBlockedProvisions] = useState<
    { legislationTypeId: string; policyOptionId: string }[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [billsLoading, setBillsLoading] = useState(false);
  const [billsLoaded, setBillsLoaded] = useState(false);
  const [canPropose, setCanPropose] = useState(false);

  const fetchLegislature = useCallback(async () => {
    setLoading(true);
    try {
      const legRes = await fetch(regionApiSubUrl(countryId, stateId, "legislature"), {
        cache: "no-store",
      });

      if (legRes.ok) {
        const legData = await legRes.json();
        setData(legData);

        if (characterId) {
          const holdsSeats = legData.officials.some(
            (o: LegislatureData["officials"][0]) => o.characterId === characterId
          );
          setCanPropose(holdsSeats);
        }
      }
    } finally {
      setLoading(false);
    }
  }, [countryId, stateId, characterId]);

  const fetchBills = useCallback(
    async (force = false) => {
      if (billsLoaded && !force) return;

      setBillsLoading(true);
      try {
        const billsRes = await fetch(regionApiSubUrl(countryId, stateId, "legislature/bills"), {
          cache: "no-store",
        });

        if (billsRes.ok) {
          const billsData = await billsRes.json();
          setBills(billsData.bills);
          setBlockedProvisions(billsData.blockedProvisions ?? []);
          setBillsLoaded(true);
        }
      } finally {
        setBillsLoading(false);
      }
    },
    [billsLoaded, countryId, stateId]
  );

  useEffect(() => {
    fetchLegislature();
  }, [fetchLegislature]);

  useEffect(() => {
    if (activeTab !== "bills") return;
    void fetchBills();
  }, [activeTab, fetchBills]);

  const ukContext = (() => {
    if (countryId !== "UK") return null;
    const nation = UK_NATIONS.find((n) => n.id === stateId);
    if (nation?.devolvedBody) {
      return { label: nation.devolvedBody, backHref: regionUrl("UK", stateId) };
    }
    const region = UK_REGIONS.find((r) => r.id === stateId);
    const parentNation = UK_NATIONS.find((n) => n.id === region?.nationId);
    if (parentNation?.devolvedBody) {
      return { label: parentNation.devolvedBody, backHref: regionUrl("UK", stateId) };
    }
    return { label: `${stateName} Legislature`, backHref: regionUrl("UK", stateId) };
  })();

  const tabs: { id: TabId; label: string }[] = [
    { id: "bills", label: "Bills" },
    { id: "composition", label: "Composition" },
  ];

  const countryConfig = COUNTRY_CONFIGS[countryId as CountryId];
  const billChamber = getSubNationalLegislatureKey(countryId as CountryId) as BillChamber;
  const subChamber = countryConfig?.subNationalChamber;
  // UK uses per-region council names (Scottish Parliament, Senedd, etc.); other
  // countries with a sub-national chamber use the chamber name directly (US →
  // "State Senate"). The final fallback covers any future country with no
  // configured sub-national chamber. Discriminate UK by the existence of the
  // stateId in UK_REGIONS to stay config-driven (no hardcoded country literal —
  // see local/no-country-literals lint rule).
  const ukRegionEntry = UK_REGIONS.find((r) => r.id === stateId);
  const chamberLabel = (() => {
    if (ukRegionEntry && subChamber) {
      const ukCouncilName = getUKCouncilName(stateId);
      return ukCouncilName === "Regional Council" ? `${stateName} Regional Council` : ukCouncilName;
    }
    if (subChamber) {
      return `${stateName} ${subChamber.name}`;
    }
    return `${stateName} State Senate`;
  })();
  const regionLabel = isParliamentarySystem(countryConfig) ? "Constituency" : "District";

  return (
    <div className="min-h-screen bg-background">
      <main className="mx-auto max-w-7xl px-4 py-8">
        {/* Hero */}
        <div className="rounded-2xl border border-card-border bg-card p-6 mb-6">
          <div className="flex items-center gap-2 text-sm text-muted mb-2">
            <Link
              href={ukContext ? ukContext.backHref : regionUrl(countryId, stateId)}
              className="hover:text-primary"
            >
              {stateName}
            </Link>
            <span>/</span>
            <span>Legislature</span>
          </div>
          <h1 className="text-2xl font-bold text-foreground mb-2">{chamberLabel}</h1>
          <p className="text-muted">
            {totalSeats} Seats
            {data && ` · ${data.state.filledSeats} Filled`}
          </p>
          {!ukContext && data?.governor && (
            <p className="text-sm text-muted mt-1">
              Governor:{" "}
              {data.governor.characterId ? (
                <Link
                  href={`/character/${data.governor.sequentialId ?? data.governor.characterId}`}
                  className="font-medium text-foreground hover:text-primary transition-colors"
                >
                  {data.governor.characterName ?? "Vacant"}
                </Link>
              ) : (
                (data.governor.characterName ?? "Vacant")
              )}
            </p>
          )}
        </div>

        {/* Tabs */}
        <div className="flex gap-2 mb-6 border-b border-card-border">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                activeTab === tab.id
                  ? "border-primary text-primary"
                  : "border-transparent text-muted hover:text-foreground"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        {loading ? (
          // Silhouettes the composition table: search bar row + member rows.
          <CardSkeleton className="min-h-[28rem]">
            <Skeleton className="h-9 w-full max-w-sm mb-4" />
            {Array.from({ length: 6 }).map((_, i) => (
              <ListRowSkeleton key={i} withBadge />
            ))}
          </CardSkeleton>
        ) : activeTab === "composition" ? (
          data ? (
            <LegislatureCompositionSection
              data={mapToCompositionData(data, totalSeats)}
              chamberLabel={chamberLabel}
              showSeatsColumn={true}
              regionLabel={regionLabel}
              searchPlaceholder={`Search ${chamberLabel.toLowerCase()}...`}
              countryId={countryId as CountryId}
            />
          ) : (
            <div className="rounded-xl border border-card-border bg-card p-12 text-center text-muted">
              Composition data unavailable.
            </div>
          )
        ) : billsLoading && !billsLoaded ? (
          // Silhouettes the bills list: stacked bill rows with status badges.
          <CardSkeleton className="min-h-[28rem]">
            {Array.from({ length: 5 }).map((_, i) => (
              <ListRowSkeleton key={i} lines={3} withBadge />
            ))}
          </CardSkeleton>
        ) : (
          <BillsTab
            bills={bills}
            canPropose={canPropose}
            canVote={canPropose}
            stateId={stateId}
            countryId={countryId}
            blockedProvisions={blockedProvisions}
            onRefresh={() => {
              void fetchBills(true);
            }}
            totalSeats={totalSeats}
            adminOverride={isAdmin}
            billChamber={billChamber}
          />
        )}
      </main>
    </div>
  );
}
