"use client";

import { useState, useEffect, useCallback, Suspense } from "react";
import Link from "next/link";
import { HeroImage } from "@/components/HeroImage";
import { Skeleton } from "@/components/ui";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { CongressCompositionTab } from "./components/CongressCompositionTab";
import { CongressBillsTab } from "./components/CongressBillsTab";
import { CongressLeadershipTab } from "./components/CongressLeadershipTab";
import {
  CHAMBER_HERO,
  type ChamberTab,
  type PageTab,
  type SenateClassFilter,
  type LeaderStrip,
} from "./components/CongressConstants";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { TariffsTab } from "@/components/legislature/TariffsTab";
import { SubsidiesTab } from "@/components/legislature/SubsidiesTab";
import type { CongressMembersResponse } from "@/lib/congress/types";
import type { BillsResponse } from "@/lib/legislature/dto/billDisplay";

export function USCongressPage({ countryId }: { countryId: CountryId }) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [activeTabState, setActiveTabState] = useState<ChamberTab>(() =>
    searchParams.get("chamber") === "house" ? "house" : "senate"
  );
  const [pageTabState, setPageTabState] = useState<PageTab>(() =>
    searchParams.get("tab") === "bills"
      ? "bills"
      : searchParams.get("tab") === "leadership"
        ? "leadership"
        : searchParams.get("tab") === "tariffs"
          ? "tariffs"
          : searchParams.get("tab") === "subsidies"
            ? "subsidies"
            : "bills"
  );
  const setPageTab = useCallback(
    (tab: PageTab) => {
      setPageTabState(tab);
      const params = new URLSearchParams(searchParams.toString());
      params.set("tab", tab);
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [searchParams, router, pathname]
  );
  const pageTab = pageTabState;
  const setActiveTab = useCallback(
    (tab: ChamberTab) => {
      setActiveTabState(tab);
      const params = new URLSearchParams(searchParams.toString());
      params.set("chamber", tab);
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [searchParams, router, pathname]
  );
  const activeTab = activeTabState;
  const [senateClassFilter, setSenateClassFilter] = useState<SenateClassFilter>(0);
  const [senateData, setSenateData] = useState<CongressMembersResponse | null>(null);
  const [houseData, setHouseData] = useState<CongressMembersResponse | null>(null);
  const [leaders, setLeaders] = useState<LeaderStrip[]>([]);
  const [billsCanPropose, setBillsCanPropose] = useState(false);
  const [billsAdminOverride, setBillsAdminOverride] = useState(false);
  const [billsMyChamber, setBillsMyChamber] = useState<"house" | "senate" | null>(null);
  const [billsHasActiveBill, setBillsHasActiveBill] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{ message: string; details: string[] } | null>(null);

  // Sync URL params to state - only update if different to avoid loops
  useEffect(() => {
    const tab = searchParams.get("tab");
    if (tab === "contracts") {
      router.replace(`/country/${countryId.toLowerCase()}/government-contracts?type=extraction`);
      return;
    }
    if (
      (tab === "bills" ||
        tab === "composition" ||
        tab === "leadership" ||
        tab === "tariffs" ||
        tab === "subsidies") &&
      tab !== pageTabState
    ) {
      setPageTabState(tab as typeof pageTabState);
    }
  }, [searchParams, pageTabState, countryId, router]);

  useEffect(() => {
    const chamber = searchParams.get("chamber");
    if ((chamber === "house" || chamber === "senate") && chamber !== activeTabState) {
      setActiveTabState(chamber);
    }
  }, [searchParams, activeTabState]);

  const fetchMembers = useCallback(async () => {
    setLoading(true);
    setError(null);
    const failures: string[] = [];
    try {
      const countryCode = countryId.toLowerCase();
      const fetchOpts = { signal: AbortSignal.timeout(15_000) };
      const [sRes, hRes, bRes, leadersRes] = await Promise.all([
        fetch(`/api/country/${countryCode}/congress/members?chamber=senate`, fetchOpts),
        fetch(`/api/country/${countryCode}/congress/members?chamber=house`, fetchOpts),
        fetch("/api/congress/bills?chamber=house", fetchOpts),
        fetch("/api/congress/leaders", fetchOpts),
      ]);
      if (sRes.ok) {
        setSenateData(await sRes.json());
      } else {
        failures.push(`Senate data (${sRes.status})`);
      }
      if (hRes.ok) {
        setHouseData(await hRes.json());
      } else {
        failures.push(`House data (${hRes.status})`);
      }
      if (bRes.ok) {
        const bd: BillsResponse = await bRes.json();
        setBillsCanPropose(bd.canPropose);
        setBillsAdminOverride(bd.adminOverride ?? false);
        setBillsMyChamber(bd.myChamber ?? null);
        setBillsHasActiveBill(bd.hasActiveBill ?? false);
      } else {
        failures.push(`Bills data (${bRes.status})`);
      }
      if (leadersRes.ok) {
        const lr = await leadersRes.json();

        setLeaders(
          (lr.leaders ?? []).map((l: LeaderStrip) => ({
            role: l.role,
            label: l.label,
            chamber: l.chamber,
            characterId: l.characterId ?? null,
            sequentialId: l.sequentialId ?? null,
            characterName: l.characterName ?? "",
            isVacant: l.isVacant ?? !l.characterId,
            isNPP: !!l.isNPP,
          }))
        );
      } else {
        failures.push(`Leadership data (${leadersRes.status})`);
      }
      if (failures.length > 0) {
        setError({
          message: `Failed to load ${failures.length} data source${failures.length > 1 ? "s" : ""}`,
          details: failures,
        });
      }
    } catch (err) {
      setError({
        message: "Network error loading Congress data",
        details: [String(err)],
      });
    } finally {
      setLoading(false);
    }
  }, [countryId]);

  useEffect(() => {
    fetchMembers();
  }, [fetchMembers]);

  // ── Stats strip helpers ────────────────────────────────────────────────────
  const getMajorityParty = (data: CongressMembersResponse | null) => {
    if (!data || data.composition.length === 0) return null;
    return data.composition.reduce((a, b) => (a.seats >= b.seats ? a : b));
  };

  const getLeader = (role: string) => leaders.find((l) => l.role === role) ?? null;

  const activeData = activeTab === "senate" ? senateData : houseData;
  const majorityParty = getMajorityParty(activeData);
  const majoritySeats = majorityParty?.seats ?? 0;
  const totalSeats = activeData?.totalSeats ?? (activeTab === "senate" ? 100 : 435);

  const speakerOrSML =
    activeTab === "senate"
      ? getLeader("majority_leader_senate")
      : getLeader("speaker_of_the_house");

  const minorityLeader =
    activeTab === "senate"
      ? getLeader("minority_leader_senate")
      : getLeader("minority_leader_house");

  const PAGE_TABS: { key: PageTab; label: string }[] = [
    { key: "bills", label: "Bills" },
    { key: "composition", label: "Composition" },
    { key: "leadership", label: "Leadership" },
    { key: "tariffs", label: "Tariffs" },
    { key: "subsidies", label: "Subsidies" },
  ];

  const hero = CHAMBER_HERO[activeTab];
  const legislature = COUNTRY_CONFIGS[countryId].legislature;
  const upperChamberLabel = legislature.upperChamber?.shortName ?? "";
  const lowerChamberLabel = legislature.lowerChamber.shortName;

  return (
    <div className="min-h-screen bg-background">
      <main className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8 overflow-x-hidden">
        <h1 className="sr-only">
          {legislature.name} — Membership, legislation, and chamber leadership
        </h1>

        <header className="relative mb-5 overflow-hidden rounded-2xl border border-card-border bg-card shadow-lg">
          {/* Hero image */}
          <div className="relative h-[175px] w-full sm:h-[220px]">
            <HeroImage
              src={hero.image}
              alt={hero.alt}
              fill
              className="object-cover object-center"
              sizes="(max-width: 1280px) 100vw, 1280px"
              priority
            />
            <div
              className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent"
              aria-hidden
            />
            <div className="absolute inset-0 flex flex-col justify-between px-5 sm:px-6 py-4 sm:py-5">
              {/* Top: chamber switcher */}
              <div
                className="flex rounded-lg overflow-hidden w-fit border border-white/30 bg-black/60"
                role="tablist"
                aria-label="Chamber"
              >
                {(["senate", "house"] as ChamberTab[]).map((tab) => (
                  <button
                    key={tab}
                    role="tab"
                    id={`chamber-tab-${tab}`}
                    aria-selected={activeTab === tab}
                    aria-controls="congress-content"
                    onClick={() => setActiveTab(tab)}
                    className={`px-4 py-1.5 text-sm font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                      activeTab === tab
                        ? "bg-white/20 text-white"
                        : "bg-transparent text-white/70 hover:text-white hover:bg-white/10"
                    }`}
                  >
                    {tab === "senate" ? upperChamberLabel : lowerChamberLabel}
                  </button>
                ))}
              </div>
              {/* Bottom: title + tagline */}
              <div>
                <h2 className="text-xl font-bold tracking-tight text-white drop-shadow-md sm:text-2xl">
                  {hero.title}
                </h2>
                <p className="mt-1 text-sm text-white/90 drop-shadow sm:text-base">
                  {hero.tagline}
                </p>
              </div>
            </div>
          </div>

          {/* Stats strip */}
          <div className="flex items-center overflow-x-auto divide-x divide-card-border border-t border-card-border">
            {/* Majority party */}
            <div className="flex flex-col px-5 py-3 min-w-[140px]">
              <span className="text-body-sm font-medium text-muted">Majority party</span>
              {majorityParty ? (
                <span
                  className="text-base font-bold tabular-nums"
                  style={{ color: majorityParty.partyColor || undefined }}
                >
                  {majorityParty.partyName}
                </span>
              ) : (
                <span className="text-base font-bold text-muted">—</span>
              )}
            </div>

            {/* Seats */}
            <div className="flex flex-col px-5 py-3 min-w-[100px]">
              <span className="text-body-sm font-medium text-muted">Seats</span>
              <span className="text-base font-bold tabular-nums">
                {loading ? "…" : `${majoritySeats} / ${totalSeats}`}
              </span>
            </div>

            {/* Speaker / Senate Majority Leader */}
            <div className="flex flex-col px-5 py-3 min-w-[160px]">
              <span className="text-body-sm font-medium text-muted">
                {activeTab === "senate" ? `${upperChamberLabel} Leader` : "Speaker"}
              </span>
              {speakerOrSML && !speakerOrSML.isVacant && speakerOrSML.characterId ? (
                <Link
                  href={
                    speakerOrSML.isNPP
                      ? `/politicians/npp/${speakerOrSML.sequentialId ?? speakerOrSML.characterId}`
                      : `/character/${speakerOrSML.sequentialId ?? speakerOrSML.characterId}`
                  }
                  className="text-base font-bold text-primary hover:underline truncate"
                >
                  {speakerOrSML.characterName}
                </Link>
              ) : (
                <span className="text-base font-bold text-muted">Vacant</span>
              )}
            </div>

            {/* Minority Leader */}
            <div className="flex flex-col px-5 py-3 min-w-[160px]">
              <span className="text-body-sm font-medium text-muted">Minority leader</span>
              {minorityLeader && !minorityLeader.isVacant && minorityLeader.characterId ? (
                <Link
                  href={
                    minorityLeader.isNPP
                      ? `/politicians/npp/${minorityLeader.sequentialId ?? minorityLeader.characterId}`
                      : `/character/${minorityLeader.sequentialId ?? minorityLeader.characterId}`
                  }
                  className="text-base font-bold text-primary hover:underline truncate"
                >
                  {minorityLeader.characterName}
                </Link>
              ) : (
                <span className="text-base font-bold text-muted">Vacant</span>
              )}
            </div>
          </div>
        </header>

        {error && (
          <div className="mb-6 rounded-lg border border-red-500/40 bg-red-500/10 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-red-400">{error.message}</h3>
                {error.details.length > 0 && (
                  <ul className="mt-2 space-y-1 text-xs text-red-300/80">
                    {error.details.map((detail, i) => (
                      <li key={i}>• {detail}</li>
                    ))}
                  </ul>
                )}
              </div>
              <button
                onClick={fetchMembers}
                className="shrink-0 rounded-lg bg-red-500/20 px-3 py-1.5 text-xs font-medium text-red-400 hover:bg-red-500/30 transition-colors"
              >
                Retry
              </button>
            </div>
          </div>
        )}

        <div className="mb-6 flex rounded-lg border border-card-border overflow-x-auto overflow-y-hidden">
          {PAGE_TABS.map(({ key, label }) => (
            <button
              key={key}
              role="tab"
              aria-selected={pageTab === key}
              aria-controls="congress-content"
              id={`page-tab-${key}`}
              onClick={() => setPageTab(key)}
              className={`px-4 py-2 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
                pageTab === key
                  ? "bg-card-border text-foreground"
                  : "bg-card text-muted hover:text-foreground"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {loading && pageTab === "composition" ? (
          <div
            id="congress-content"
            role="tabpanel"
            aria-labelledby={`page-tab-${pageTab}`}
            className="space-y-6"
          >
            <div className="rounded-xl border border-card-border bg-card p-6">
              <Skeleton className="h-6 w-1/4 mb-4" />
              <Skeleton className="h-[200px] w-full rounded-lg mb-4" />
              <div className="space-y-2">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-3">
                    <Skeleton className="h-4 w-4 rounded-full" />
                    <Skeleton className="h-4 flex-1" />
                    <Skeleton className="h-4 w-12" />
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div id="congress-content" role="tabpanel" aria-labelledby={`page-tab-${pageTab}`}>
            {pageTab === "composition" && (
              <CongressCompositionTab
                activeTab={activeTab}
                senateData={senateData}
                houseData={houseData}
                senateClassFilter={senateClassFilter}
                setSenateClassFilter={setSenateClassFilter}
                leaders={leaders}
                countryId={countryId}
              />
            )}
            {pageTab === "bills" && (
              <CongressBillsTab
                activeTab={activeTab}
                canPropose={billsCanPropose}
                adminOverride={billsAdminOverride}
                myChamber={billsMyChamber}
                hasActiveBill={billsHasActiveBill}
                countryId={countryId}
              />
            )}
            {pageTab === "leadership" && (
              <CongressLeadershipTab activeTab={activeTab} countryId={countryId} />
            )}
            {pageTab === "tariffs" && <TariffsTab countryId={countryId} />}
            {pageTab === "subsidies" && <SubsidiesTab countryId={countryId} />}
          </div>
        )}

        <div className="mt-8">
          <Link
            href="/dashboard"
            className="text-sm text-muted hover:text-foreground transition-colors"
          >
            ← Back to dashboard
          </Link>
        </div>
      </main>
    </div>
  );
}

export default function CongressPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-background flex items-center justify-center">
          <p className="text-muted">Loading Congress…</p>
        </div>
      }
    >
      <USCongressPage countryId="US" />
    </Suspense>
  );
}
