"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useOptimistic,
  useRef,
  useState,
  startTransition,
} from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { toElectionDisplay, type ElectionsPageResponse } from "@/lib/elections/electionDisplay";
import { useCountdownTimer } from "@/hooks/useCountdownTimer";
import { useElectionActions } from "@/hooks/useElectionActions";
import { useWorldFlags } from "@/hooks/useWorldFlags";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { getMessageStyle } from "@/lib/utils/formatters";
import type { CharacterBasic, ElectionDisplay, GameStateDisplay } from "@/lib/db/types";
import type { CompositionResponse } from "@/lib/elections/electionResponseTypes";
import { EmptyState } from "@/components/ui";
import { isMapAvailable, selectElectionGroups } from "@/app/elections/components/electionsMapModel";
import { ChamberComposition } from "@/app/elections/components/ChamberComposition";
import { EmbeddedParliamentaryResults } from "@/components/elections/liveResults/EmbeddedParliamentaryResults";
import {
  electionNightTitle,
  pickElectionNightAnchor,
} from "@/lib/elections/liveResults/electionNight";
import { resolveChamberForOffice } from "@/lib/elections/officeResolution";
import { CommonsCarveUpPanel } from "@/components/uk/elections/CommonsCarveUpPanel";
import { ManifestoFlavorBar } from "@/components/uk/elections/ManifestoFlavorBar";
import { buildCommonsCarveUpSlices } from "@/lib/uk/elections/commonsCarveUp";
import { ELECTION_STATE_NAMES } from "@/app/elections/electionsHelpers";

import {
  electionsHref,
  parseElectionsParams,
  toElectionsParams,
  type ElectionsFilters,
  type RaceFilter,
} from "./electionsUrlState";
import { buildOfficeSections, defaultOpenSections, summarize } from "./electionsSelectors";
import { ElectionsHero } from "./components/ElectionsHero";
import { ElectionsControls } from "./components/ElectionsControls";
import { ElectionsSkeleton } from "./components/ElectionsSkeleton";
import { OfficeSection } from "./components/OfficeSection";

// The map pulls in react-simple-maps and only renders behind a toggle, so keep
// it out of this page's initial bundle.
const ElectionMap = dynamic(
  () => import("@/app/elections/components/ElectionMap").then((m) => m.ElectionMap),
  {
    ssr: false,
    loading: () => (
      <div className="h-[400px] w-full animate-pulse rounded-xl border border-card-border bg-card" />
    ),
  }
);

/** Must stay <= the GET /api/elections max limit so one request covers a country. */
const ELECTIONS_PAGE_SIZE = 500;

async function fetchAllElections(
  countryId: string
): Promise<{ elections: ElectionDisplay[]; error?: string }> {
  const elections: ElectionDisplay[] = [];
  let page = 1;

  try {
    for (;;) {
      const res = await fetch(
        `/api/elections?country=${countryId}&view=summary&limit=${ELECTIONS_PAGE_SIZE}&page=${page}`,
        { signal: AbortSignal.timeout(15_000) }
      );
      if (!res.ok) {
        console.error(`Failed to fetch elections: ${res.status}`);
        return { elections: [], error: `Failed to fetch elections: ${res.status}` };
      }

      const data = (await res.json()) as ElectionsPageResponse;
      const batch = Array.isArray(data.elections) ? data.elections : [];
      elections.push(...batch.map(toElectionDisplay));

      const total = typeof data.total === "number" ? data.total : elections.length;
      if (batch.length <= 0 || page * ELECTIONS_PAGE_SIZE >= total) break;
      page++;
    }
    return { elections };
  } catch (err) {
    console.error("Error fetching elections:", err);
    return { elections: [], error: String(err) };
  }
}

interface ElectionsClientProps {
  code: string;
  /** Server-seeded elections so the list renders without a client round trip. */
  initialElections?: ElectionDisplay[];
}

export default function ElectionsClient({ code, initialElections }: ElectionsClientProps) {
  const countryId = code.toUpperCase() as CountryId;
  const config = COUNTRY_CONFIGS[countryId];
  const countryName = config?.name ?? countryId;
  const regionLabel = config?.regionLabel ?? "State";
  const regionLabelPlural = config?.regionLabelPlural ?? "States";

  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const [elections, setElections] = useState<ElectionDisplay[]>(initialElections ?? []);
  const [character, setCharacter] = useState<CharacterBasic | null>(null);
  const [characterChecked, setCharacterChecked] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [, setGameState] = useState<GameStateDisplay | null>(null);
  const [composition, setComposition] = useState<CompositionResponse | null>(null);
  const [loading, setLoading] = useState(initialElections === undefined);
  const skipInitialFetch = useRef(initialElections !== undefined);

  // The URL is the single source of truth for every filter, so a view is
  // linkable and survives back/forward. `useOptimistic` applies a change at once
  // and reconciles when the navigation commits, otherwise the controls freeze
  // until the server payload lands and a second click merges from stale state.
  const urlFilters = useMemo(() => parseElectionsParams(searchParams), [searchParams]);
  const [filters, applyOptimisticFilters] = useOptimistic(urlFilters);

  const navigate = useCallback(
    (next: Partial<ElectionsFilters>, mode: "push" | "replace") => {
      const merged = { ...filters, ...next };
      const qs = toElectionsParams(merged).toString();
      const url = qs ? `${pathname}?${qs}` : pathname;
      startTransition(() => {
        applyOptimisticFilters(merged);
        if (mode === "push") router.push(url, { scroll: false });
        else router.replace(url, { scroll: false });
      });
    },
    [filters, pathname, router, applyOptimisticFilters]
  );

  useCountdownTimer();

  const fetchSecondary = useCallback(async () => {
    try {
      const opts = { signal: AbortSignal.timeout(15_000) };
      const [charRes, compositionRes, gameStateRes] = await Promise.all([
        fetch("/api/character/me", opts),
        fetch(`/api/elections/composition?country=${countryId}`, opts),
        fetch("/api/game/turn/status", opts),
      ]);
      if (charRes.ok) {
        const data = await charRes.json();
        setCharacter(data.character);
        setCharacterChecked(true);
      } else if (charRes.status === 404) {
        setCharacterChecked(true);
      }
      if (compositionRes.ok) setComposition(await compositionRes.json());
      if (gameStateRes.ok) {
        const gs = await gameStateRes.json();
        setGameState({
          isActive: gs.isActive,
          pausedAt: gs.pausedAt ?? null,
          lastTurnProcessed: gs.lastTurnProcessed ?? null,
          currentYear: gs.currentYear,
          currentTurn: gs.currentTurn,
        });
      }
    } catch (err) {
      console.error("Error fetching election secondaries:", err);
    }
  }, [countryId]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setFetchError(null);
    try {
      const result = await fetchAllElections(countryId);
      setElections(result.elections);
      if (result.error) setFetchError(result.error);
      await fetchSecondary();
    } catch (err) {
      console.error("Error fetching elections:", err);
      setFetchError(String(err));
    } finally {
      setLoading(false);
    }
  }, [countryId, fetchSecondary]);

  useEffect(() => {
    if (skipInitialFetch.current) {
      skipInitialFetch.current = false;
      fetchSecondary();
      return;
    }
    fetchData();
  }, [fetchData, fetchSecondary]);

  const { actionLoading, message, handleEnterRace, handleWithdraw, isInRace, isInAnyRace } =
    useElectionActions({ character, elections, onSuccess: fetchData });
  const { liveElectionResultsEnabled } = useWorldFlags();

  const allRegions = useMemo(() => [...new Set(elections.map((e) => e.state))].sort(), [elections]);

  // One derivation for both views: `mapGroups` stays country-wide while the list
  // honors the region filter. Deriving them separately is what previously let the
  // map read region-filtered data and collapse to a single region.
  const { listElections: filtered, mapGroups: groupsAll } = useMemo(
    () =>
      selectElectionGroups(elections, allRegions, {
        race: filters.race,
        hideUpcoming: filters.hideUpcoming,
        competitive: filters.competitive,
        primary: filters.primary,
        contest: filters.contest,
        region: filters.state,
      }),
    [
      elections,
      allRegions,
      filters.race,
      filters.hideUpcoming,
      filters.competitive,
      filters.primary,
      filters.contest,
      filters.state,
    ]
  );

  const sections = useMemo(() => buildOfficeSections(countryId, filtered), [countryId, filtered]);
  const summary = useMemo(() => summarize(filtered), [filtered]);

  // `null` means the viewer has not chosen, so the page opens the largest
  // section. An explicit empty array is a deliberate all-collapsed.
  const openSections = filters.open ?? defaultOpenSections(sections);
  const toggleSection = useCallback(
    (key: string) => {
      const current = filters.open ?? defaultOpenSections(sections);
      const next = current.includes(key) ? current.filter((k) => k !== key) : [...current, key];
      navigate({ open: next }, "replace");
    },
    [filters.open, sections, navigate]
  );

  const mapAvailable = isMapAvailable(countryId, filters.race, groupsAll);
  const effectiveView = mapAvailable ? filters.view : "list";

  // The composition panel needs a single chamber to describe, so it shows only
  // when the viewer has narrowed to one office that sits in one.
  const compositionChamber = useMemo(() => {
    if (!filters.race) return null;
    const officeKey = filters.race.includes("-") ? filters.race.split("-")[0] : filters.race;
    return resolveChamberForOffice(countryId, officeKey);
  }, [countryId, filters.race]);

  /**
   * UK Commons races carry a demographic carve-up and a manifesto bar. They were
   * rendered per race in the old card list; here they sit under the section's
   * table so a contested race keeps its detail without turning every row into a
   * panel. Only contested races have anything to show.
   */
  const sectionFooter = useCallback(
    (sectionKey: string) => {
      if (countryId !== "UK" || sectionKey !== "commons") return null;
      const contested = filtered.filter(
        (e) => e.electionType === "commons" && e.candidates.length > 0
      );
      if (contested.length === 0) return null;
      return (
        <div className="space-y-4">
          {contested.map((election) => {
            const carveUp = buildCommonsCarveUpSlices(election);
            return (
              <div key={election.id} className="space-y-3">
                <ManifestoFlavorBar
                  countryCode={code}
                  electionId={election.id}
                  regionId={election.state}
                />
                <CommonsCarveUpPanel
                  regionName={ELECTION_STATE_NAMES[election.state] ?? election.state}
                  regionId={election.state}
                  slices={carveUp.slices}
                  topDemographics={carveUp.topDemographics}
                />
              </div>
            );
          })}
        </div>
      );
    },
    [countryId, filtered]
  );

  return (
    <div className="min-h-screen bg-background pb-16">
      <main className="mx-auto min-w-0 max-w-7xl space-y-8 overflow-x-hidden px-4 py-8 sm:px-6 sm:py-12">
        {loading ? (
          <ElectionsSkeleton />
        ) : (
          <>
            <ElectionsHero countryName={countryName} summary={summary} showStats />

            {message && (
              <div className={`rounded-lg p-4 ${getMessageStyle(message)}`}>{message}</div>
            )}

            {fetchError && (
              <div className="rounded-xl border border-error/50 bg-error/10 p-4">
                <p className="text-error">
                  Failed to load election data. Please try refreshing the page.
                </p>
              </div>
            )}

            {!character && characterChecked && (
              <div className="rounded-xl border border-warning/50 bg-warning/10 p-4">
                <p className="text-warning">
                  You need to{" "}
                  <Link href="/register" className="underline hover:text-warning">
                    create a character
                  </Link>{" "}
                  before you can stand in an election.
                </p>
              </div>
            )}

            <ElectionsControls
              countryId={countryId}
              regionLabel={regionLabel}
              regionLabelPlural={regionLabelPlural}
              availableRegions={allRegions}
              race={filters.race}
              region={filters.state}
              competitive={filters.competitive}
              hideUpcoming={filters.hideUpcoming}
              primary={filters.primary}
              contest={filters.contest}
              view={effectiveView}
              mapAvailable={mapAvailable}
              onRace={(race: RaceFilter) => navigate({ race, open: null }, "push")}
              onRegion={(state) => navigate({ state }, "push")}
              onToggleCompetitive={() => navigate({ competitive: !filters.competitive }, "replace")}
              onToggleHideUpcoming={() =>
                navigate({ hideUpcoming: !filters.hideUpcoming }, "replace")
              }
              onPrimary={(primary) => navigate({ primary }, "replace")}
              onContest={(contest) => navigate({ contest }, "replace")}
              onView={(view) => navigate({ view }, "push")}
            />

            {composition && compositionChamber && (
              <ChamberComposition
                composition={composition}
                chamberKey={compositionChamber.key}
                activeSenateClass={
                  filters.race.includes("-")
                    ? Number.parseInt(filters.race.split("-")[1] ?? "", 10) || null
                    : composition.activeUpperClass
                }
              />
            )}

            {liveElectionResultsEnabled &&
              (() => {
                const anchor = pickElectionNightAnchor(filtered);
                if (!anchor) return null;
                return (
                  <EmbeddedParliamentaryResults
                    electionId={anchor.id}
                    electionType={anchor.electionType}
                    title={electionNightTitle(anchor.electionType)}
                  />
                );
              })()}

            {effectiveView === "map" && (
              <div className="rounded-xl border border-card-border bg-card p-5">
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-foreground">Election map</h2>
                  <span className="text-xs text-muted">
                    Click a {regionLabel.toLowerCase()} to see its races
                  </span>
                </div>
                <ElectionMap
                  countryId={countryId}
                  electionsByState={groupsAll}
                  onRegionClick={(regionId) => navigate({ state: regionId, view: "list" }, "push")}
                  regionHref={(regionId) =>
                    electionsHref(pathname, { ...filters, state: regionId, view: "list" })
                  }
                />
              </div>
            )}

            {effectiveView === "list" &&
              (sections.length === 0 ? (
                <div className="rounded-xl border border-card-border bg-card p-12">
                  <EmptyState
                    title="No races match these filters"
                    description="Clear a filter, or check back when the next cycle opens."
                    actionLabel={`Back to ${countryName}`}
                    actionHref={`/country/${code.toLowerCase()}`}
                  />
                </div>
              ) : (
                <div className="space-y-6">
                  {sections.map((section) => (
                    <OfficeSection
                      key={section.key}
                      section={section}
                      regionLabel={regionLabel}
                      expanded={openSections.includes(section.key)}
                      onToggle={toggleSection}
                      character={character}
                      isInRace={isInRace}
                      isInAnyRace={isInAnyRace}
                      actionLoading={actionLoading}
                      onEnterRace={handleEnterRace}
                      onWithdraw={handleWithdraw}
                      footer={sectionFooter(section.key)}
                    />
                  ))}
                </div>
              ))}

            <div className="pt-2">
              <Link
                href={`/country/${code.toLowerCase()}`}
                className="text-sm text-muted transition-colors hover:text-foreground"
              >
                &larr; Back to {countryName}
              </Link>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
