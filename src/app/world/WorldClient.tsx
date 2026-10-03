"use client";

import Link from "next/link";
import { type CountryId } from "@/lib/constants/countries";
import { resolveCountryAvailability } from "@/lib/countryAvailability";
import { WORLD_ROADMAP_COUNTRIES } from "@/lib/worldCountryRegistry";
import CountryCard from "./components/CountryCard";
import {
  TIER_ORDER,
  TIER_LABELS,
  TIER_COLORS,
  TIER_STROKES,
} from "@/components/landing/countryTiers";
import PlannedCountryCard from "./components/PlannedCountryCard";
import WorldMapSVG from "./components/WorldMapSVG";
import type { NationWorldSnapshot } from "@/lib/world/nationWorldSnapshots";
import type { CountryAccessMap } from "./page";
import { WorldMetricFilterProvider } from "./WorldMetricFilterContext";
import type { WorldEntityMapSnapshot } from "@/lib/world/worldEntityMap";
import type { BlocMapData } from "@/lib/world/blocMembership";

interface WorldClientProps {
  countryAccess: CountryAccessMap;
  nationSnapshots: Record<CountryId, NationWorldSnapshot>;
  /** Gates the "Conflicts" hub card; mirrors the World navbar link. */
  conflictsEnabled: boolean;
  worldEntities: WorldEntityMapSnapshot;
  /** entityId → bloc, for the globe's Blocs mode. */
  blocMapData: BlocMapData;
}

export default function WorldClient({
  countryAccess,
  nationSnapshots,
  conflictsEnabled,
  worldEntities,
  blocMapData,
}: WorldClientProps) {
  // `countryAccess` is keyed by the runtime registered set (getAllCountryAccess →
  // COUNTRY_ORDER ∪ active countryGameStates), so its keys are the SSOT for which
  // countries to render here, so an activated SCO/WAL enters without a redeploy.
  const registeredCountryIds = Object.keys(countryAccess) as CountryId[];
  const countryAvailability = Object.fromEntries(
    registeredCountryIds.map((id) => [id, resolveCountryAvailability(id, countryAccess[id])])
  ) as Record<CountryId, ReturnType<typeof resolveCountryAvailability>>;

  return (
    <WorldMetricFilterProvider>
      <div className="min-h-screen bg-background pb-20">
        <main className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-10 space-y-12">
          <header className="max-w-2xl space-y-2">
            <h1 className="text-3xl font-bold tracking-tight text-foreground">World</h1>
            <p className="text-base text-muted leading-relaxed">
              This page lists every nation in the game, with world events, trade, and the all-time
              rankings below.
            </p>
          </header>

          {/* Map Section */}
          <section className="space-y-4">
            <WorldMapSVG
              countryAccess={countryAccess}
              worldEntities={worldEntities}
              blocMapData={blocMapData}
            />
            <div className="flex flex-wrap justify-center gap-6 text-xs text-muted">
              {TIER_ORDER.map((tier) => (
                <div key={tier} className="flex items-center gap-2">
                  <span
                    className="w-3 h-3 rounded-full border"
                    style={{
                      backgroundColor: TIER_COLORS[tier],
                      borderColor:
                        tier === "background" ? TIER_STROKES.economic : TIER_STROKES[tier],
                    }}
                  />
                  <span>{TIER_LABELS[tier]}</span>
                </div>
              ))}
            </div>
            <p className="text-center text-xs text-muted-foreground">
              Light borders identify background nations with aggregate data. Tap or click to inspect
              them.
            </p>
          </section>

          {/* Three grids: nations you can play, nations you can only browse, and
              nations that are not in the game yet. */}
          {(() => {
            const enabledCountries = registeredCountryIds.filter(
              (id) => countryAvailability[id].accessMode === "full"
            );
            const econOnlyCountries = registeredCountryIds.filter(
              (id) => countryAvailability[id].accessMode === "econ-only"
            );
            const hiddenCountries = registeredCountryIds.filter(
              (id) => countryAvailability[id].accessMode === "hidden"
            );
            econOnlyCountries.sort(
              (a, b) => countryAvailability[a].sortOrder - countryAvailability[b].sortOrder
            );

            return (
              <>
                {enabledCountries.length > 0 && (
                  <section className="space-y-6">
                    <div className="flex items-center justify-between border-b border-card-border pb-4">
                      <h2 className="text-2xl font-bold tracking-tight text-foreground">
                        Select a nation
                      </h2>
                    </div>
                    <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                      {enabledCountries.map((id) => (
                        <CountryCard
                          key={id}
                          id={id}
                          availability={countryAvailability[id]}
                          nationSnapshot={nationSnapshots[id]}
                        />
                      ))}
                    </div>
                  </section>
                )}

                {econOnlyCountries.length > 0 && (
                  <section className="space-y-6">
                    <div className="space-y-1 border-b border-card-border pb-4">
                      <h2 className="text-2xl font-bold tracking-tight text-foreground">
                        Econ-only nations
                      </h2>
                      <p className="text-sm text-muted">
                        Open to browse, not to play. Read their politics, their legislature, and
                        their economy to see what you are investing in.
                      </p>
                    </div>
                    <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                      {econOnlyCountries.map((id) => (
                        <CountryCard
                          key={id}
                          id={id}
                          availability={countryAvailability[id]}
                          nationSnapshot={nationSnapshots[id]}
                        />
                      ))}
                    </div>
                  </section>
                )}

                {(hiddenCountries.length > 0 || WORLD_ROADMAP_COUNTRIES.length > 0) && (
                  <section className="space-y-6">
                    <div className="flex items-center gap-3 border-b border-card-border pb-4">
                      <h2 className="text-2xl font-bold tracking-tight text-foreground">
                        Planned nations
                      </h2>
                    </div>
                    <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                      {hiddenCountries.map((id) => (
                        <CountryCard
                          key={id}
                          id={id}
                          availability={countryAvailability[id]}
                          nationSnapshot={nationSnapshots[id]}
                        />
                      ))}
                      {WORLD_ROADMAP_COUNTRIES.map((country) => (
                        <PlannedCountryCard
                          key={country.id}
                          id={country.id}
                          name={country.name}
                          region={country.region}
                          featured={country.featured}
                        />
                      ))}
                    </div>
                  </section>
                )}
              </>
            );
          })()}

          {/* Crises */}
          <section className="space-y-4">
            <div className="flex items-center justify-between border-b border-card-border pb-4">
              <h2 className="text-2xl font-bold tracking-tight text-foreground">World events</h2>
              <Link
                href="/world/crises"
                className="text-sm text-primary hover:underline font-medium"
              >
                View all →
              </Link>
            </div>
            <Link
              href="/world/crises"
              className="flex items-center gap-4 rounded-xl border border-card-border bg-card p-5 shadow-card card-hover group"
            >
              <div className="min-w-0">
                <p className="text-sm font-semibold text-foreground group-hover:text-primary transition-colors">
                  Global crises
                </p>
                <p className="text-xs text-muted mt-0.5">
                  Active world events affecting nations, economies, and metrics.
                </p>
              </div>
              <svg
                className="h-4 w-4 text-muted ml-auto shrink-0 transition-transform group-hover:translate-x-0.5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 5l7 7-7 7"
                />
              </svg>
            </Link>
          </section>

          {/* Conflicts, gated behind the Conflicts subsystem flag */}
          {conflictsEnabled && (
            <section className="space-y-4">
              <div className="flex items-center justify-between border-b border-card-border pb-4">
                <h2 className="text-2xl font-bold tracking-tight text-foreground">World affairs</h2>
                <Link
                  href="/world/conflicts"
                  className="text-sm font-medium text-primary hover:underline"
                >
                  View all →
                </Link>
              </div>
              <Link
                href="/world/conflicts"
                className="card-hover group flex items-center gap-4 rounded-xl border border-card-border bg-card p-5 shadow-card"
              >
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-foreground transition-colors group-hover:text-primary">
                    Conflicts
                  </p>
                  <p className="mt-0.5 text-xs text-muted">
                    Rivalries, blocs, and confrontations between nations.
                  </p>
                </div>
                <svg
                  className="ml-auto h-4 w-4 shrink-0 text-muted transition-transform group-hover:translate-x-0.5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 5l7 7-7 7"
                  />
                </svg>
              </Link>
            </section>
          )}

          {/* World Trade */}
          <section className="space-y-4">
            <div className="flex items-center justify-between border-b border-card-border pb-4">
              <h2 className="text-2xl font-bold tracking-tight text-foreground">World trade</h2>
              <Link
                href="/world/trade"
                className="text-sm font-medium text-primary hover:underline"
              >
                Open ledger →
              </Link>
            </div>
            <Link
              href="/world/trade"
              className="card-hover group flex items-center gap-4 rounded-xl border border-card-border bg-card p-5 shadow-card"
            >
              <div className="min-w-0">
                <p className="text-sm font-semibold text-foreground transition-colors group-hover:text-primary">
                  Balance of trade
                </p>
                <p className="mt-0.5 text-xs text-muted">
                  Surplus and deficit between nations by country, commodity, and pair.
                </p>
              </div>
              <svg
                className="ml-auto h-4 w-4 shrink-0 text-muted transition-transform group-hover:translate-x-0.5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 5l7 7-7 7"
                />
              </svg>
            </Link>
          </section>

          {/* Hall of Fame */}
          <section className="space-y-4">
            <div className="flex items-center justify-between border-b border-card-border pb-4">
              <h2 className="text-2xl font-bold tracking-tight text-foreground">Hall of fame</h2>
              <Link
                href="/world/legacy"
                className="text-sm font-medium text-primary hover:underline"
              >
                View rankings →
              </Link>
            </div>
            <Link
              href="/world/legacy"
              className="card-hover group flex items-center gap-4 rounded-xl border border-card-border bg-card p-5 shadow-card"
            >
              <div className="min-w-0">
                <p className="text-sm font-semibold text-foreground transition-colors group-hover:text-primary">
                  Every player, ranked
                </p>
                <p className="mt-0.5 text-xs text-muted">
                  Legacy score across every life you have played, for the current iteration or all
                  time.
                </p>
              </div>
              <svg
                className="ml-auto h-4 w-4 shrink-0 text-muted transition-transform group-hover:translate-x-0.5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 5l7 7-7 7"
                />
              </svg>
            </Link>
          </section>
        </main>
      </div>
    </WorldMetricFilterProvider>
  );
}
