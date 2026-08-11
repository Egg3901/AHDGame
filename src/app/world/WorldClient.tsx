"use client";

import Link from "next/link";
import { type CountryId } from "@/lib/constants/countries";
import { resolveCountryAvailability } from "@/lib/countryAvailability";
import { WORLD_ROADMAP_COUNTRIES } from "@/lib/worldCountryRegistry";
import CountryCard from "./components/CountryCard";
import PlannedCountryCard from "./components/PlannedCountryCard";
import WorldMapSVG from "./components/WorldMapSVG";
import type { NationWorldSnapshot } from "@/lib/world/nationWorldSnapshots";
import type { CountryAccessMap } from "./page";
import { WorldMetricFilterProvider } from "./WorldMetricFilterContext";
import type { WorldEntityMapSnapshot } from "@/lib/world/worldEntityMap";
import type { BlocMembership } from "@/lib/world/blocMembership";

interface WorldClientProps {
  countryAccess: CountryAccessMap;
  nationSnapshots: Record<CountryId, NationWorldSnapshot>;
  /** Gates the "Conflicts" hub card — mirrors the World navbar link. */
  conflictsEnabled: boolean;
  worldEntities: WorldEntityMapSnapshot;
  /** entityId → bloc, for the globe's Blocs mode. */
  blocMembership: BlocMembership;
}

export default function WorldClient({
  countryAccess,
  nationSnapshots,
  conflictsEnabled,
  worldEntities,
  blocMembership,
}: WorldClientProps) {
  // `countryAccess` is keyed by the runtime registered set (getAllCountryAccess →
  // COUNTRY_ORDER ∪ active countryGameStates), so its keys are the SSOT for which
  // countries to render here — an activated SCO/WAL enters without a redeploy.
  const registeredCountryIds = Object.keys(countryAccess) as CountryId[];
  const countryAvailability = Object.fromEntries(
    registeredCountryIds.map((id) => [id, resolveCountryAvailability(id, countryAccess[id])])
  ) as Record<CountryId, ReturnType<typeof resolveCountryAvailability>>;

  return (
    <WorldMetricFilterProvider>
      <div className="min-h-screen bg-background pb-20">
        <main className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-10 space-y-12">
          {/* Hero Section */}
          <div className="text-center space-y-3 max-w-2xl mx-auto">
            <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-foreground">
              Global Politics
            </h1>
            <p className="text-base text-muted leading-relaxed">
              Expand your political influence beyond borders. Navigate unique political systems and
              legislative challenges across nations.
            </p>
          </div>

          {/* Map Section */}
          <section className="space-y-4">
            <WorldMapSVG
              countryAccess={countryAccess}
              worldEntities={worldEntities}
              blocMembership={blocMembership}
            />
            <div className="flex justify-center gap-6 text-xs text-muted">
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full bg-success/80 border border-success/30" />
                <span>Full Autonomous</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full bg-warning/80 border border-warning/30" />
                <span>Sphere Macro</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full bg-purple-500/80 border border-purple-500/30" />
                <span>Historical Presence</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full bg-primary/80 border border-primary/30" />
                <span>Unclassified</span>
              </div>
              <div className="flex items-center gap-2">
                <span
                  className="w-3 h-3 rounded-full border"
                  style={{ backgroundColor: "#9333ea", borderColor: "#7e22ce" }}
                />
                <span>Active Crisis</span>
              </div>
            </div>
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
                        Select a Nation
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
                        Econ-Only Nations
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
                        Planned Nations
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
              <div className="flex items-center gap-3">
                <h2 className="text-2xl font-bold tracking-tight text-foreground">World Events</h2>
                <span className="px-2 py-0.5 rounded-full bg-purple-500/10 text-purple-400 text-xs font-bold uppercase tracking-wider border border-purple-500/20">
                  Crises
                </span>
              </div>
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
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-purple-500/20 bg-purple-500/10 text-purple-400">
                <svg
                  className="h-5 w-5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={1.5}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
                  />
                </svg>
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-foreground group-hover:text-primary transition-colors">
                  Global Crises
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

          {/* Conflicts — gated behind the Conflicts subsystem flag */}
          {conflictsEnabled && (
            <section className="space-y-4">
              <div className="flex items-center justify-between border-b border-card-border pb-4">
                <div className="flex items-center gap-3">
                  <h2 className="text-2xl font-bold tracking-tight text-foreground">
                    World Affairs
                  </h2>
                  <span className="rounded-full border border-rose-500/20 bg-rose-500/10 px-2 py-0.5 text-xs font-bold uppercase tracking-wider text-rose-400">
                    Conflicts
                  </span>
                </div>
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
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-rose-500/20 bg-rose-500/10 text-rose-400">
                  <svg
                    className="h-5 w-5"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={1.5}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M14.121 14.121L19 19m-7-7l7-7m-7 7l-2.879 2.879M12 12L9.121 9.121m0 5.758a3 3 0 10-4.243 4.243 3 3 0 004.243-4.243zm0-5.758a3 3 0 10-4.243-4.243 3 3 0 004.243 4.243z"
                    />
                  </svg>
                </div>
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
              <div className="flex items-center gap-3">
                <h2 className="text-2xl font-bold tracking-tight text-foreground">World Trade</h2>
                <span className="rounded-full border border-primary/20 bg-primary/10 px-2 py-0.5 text-xs font-bold uppercase tracking-wider text-primary">
                  Ledger
                </span>
              </div>
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
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-primary/20 bg-primary/10 text-primary">
                <svg
                  className="h-5 w-5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={1.5}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M3 7.5 7.5 3m0 0L12 7.5M7.5 3v13.5m13.5 0L16.5 21m0 0L12 16.5m4.5 4.5V7.5"
                  />
                </svg>
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-foreground transition-colors group-hover:text-primary">
                  Balance of Trade
                </p>
                <p className="mt-0.5 text-xs text-muted">
                  Surplus and deficit between nations — by country, commodity, and pair.
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
              <div className="flex items-center gap-3">
                <h2 className="text-2xl font-bold tracking-tight text-foreground">Hall of Fame</h2>
              </div>
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
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-warning/20 bg-warning/10 text-warning">
                <svg
                  className="h-5 w-5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={1.5}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z"
                  />
                </svg>
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-foreground transition-colors group-hover:text-primary">
                  Every player, ranked
                </p>
                <p className="mt-0.5 text-xs text-muted">
                  Legacy Score across every life you&apos;ve ever played — current iteration or all
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
