/**
 * Where every Japan-bearing file in the tree is accounted for.
 *
 * WHY THIS FILE EXISTS: the country-folder plan tracked Japan's footprint by
 * hand across five uncross-checked places. Eight revisions each corrected the
 * last and reintroduced the same defect class. Three attempts at a mechanical
 * guard then repeated it at one remove:
 *
 *   - the first matched a JP object key alone, and missed 47 of the 48
 *     Japan-NAMED files (~17,000 LOC), because a file that *is* Japan carries
 *     no `JP:` key;
 *   - the second added Japan-named files, jp_<slug> keys and `=== "JP"`, and
 *     still missed constants/states.ts, which declares JP_SHUGIIN_SEATS (465),
 *     JP_SANGIIN_SEATS (248) and JP_GOVERNOR_SEATS -- Japan's canonical chamber
 *     seat tables -- under a name none of the four rules matched.
 *
 * The denominator is now a union of FIVE ground truths; see jpCoverage.test.ts,
 * which also states why consumers are excluded and JPY/JPEG/JPG are not Japan.
 * The walk covers scripts/ as well as src/.
 *
 * WHAT THIS GUARANTEES: that no Japan-bearing file goes unexamined. It does NOT
 * guarantee the bucket is right, and it does NOT guarantee the file is assigned
 * to a phase. Assignment is still tracked in prose, which is the next thing that
 * will rot.
 *
 * Classification is per FILE, and several files hold registries of more than one
 * kind (`currencies.ts` carries COUNTRY_CURRENCY_MAP, which moves, beside
 * INITIAL_RATES*, which must not). A file sits in the bucket describing its
 * DOMINANT treatment; the per-symbol split lives in the plan's registry tables.
 *
 * Precedence when a file could sit in two buckets:
 *   E > out-of-scope > F > B > C > D > A
 */

/**
 * Already per-country: Japan-named modules that relocate wholesale into
 * `src/lib/countries/jp/`.
 *
 * Size note: jpLegislationTypes.ts is 6,169 LOC, well past the 2,000-line
 * blocking cap. SIZE_CAP_EXEMPT matches by SUBSTRING, so moving it out of
 * `seeds/jp/` strips its exemption unless the new path is added first.
 *
 * `seeds/jp/` holds 34 source files plus 5 tests. The plan's "move the 39 files"
 * is right about the directory and wrong about the destination: tests do not
 * belong under `data/`.
 */
export const BUCKET_D_RELOCATE: readonly string[] = [
  "scripts/geo/build-japan-geo.mjs",
  "scripts/migrations/backfill-jp-sangiin-seat-ids.ts",
  "scripts/migrations/fix-jp-sector-market-sizes.ts",
  "scripts/seed/seed-jp.ts",
  "src/lib/admin/seed/seedJP.ts",
  "src/lib/admin/seed/seedJpBudgets.ts",
  "src/lib/constants/japan.ts",
  "src/lib/constants/jpCabinet.ts",
  "src/lib/constants/jpCabinetMechanics.ts",
  "src/lib/constants/jpCabinetOrders.ts",
  "src/lib/events/pree/handlers/jpEvents.ts",
  "src/lib/maps/japanGeometry.ts",
  "src/lib/seeds/international/jp.ts",
  "src/lib/seeds/jp/jpBudgets.ts",
  "src/lib/seeds/jp/jpCorporations.ts",
  "src/lib/seeds/jp/jpDemographicCategories.ts",
  "src/lib/seeds/jp/jpDemographicTurnout.ts",
  "src/lib/seeds/jp/jpGovernmentFormation.ts",
  "src/lib/seeds/jp/jpLegislationTypes.ts",
  "src/lib/seeds/jp/jpMetricPresets.ts",
  "src/lib/seeds/jp/jpMetricPresets1953.ts",
  "src/lib/seeds/jp/jpMetricPresets1979.ts",
  "src/lib/seeds/jp/jpParties.ts",
  "src/lib/seeds/jp/jpPopulationAnchors.ts",
  "src/lib/seeds/jp/jpRegionCensusData.ts",
  "src/lib/seeds/jp/jpRegionCensusData1953.ts",
  "src/lib/seeds/jp/jpRegionCensusData1979.ts",
  "src/lib/seeds/jp/jpRegionCensusData1991.ts",
  "src/lib/seeds/jp/jpRegionCensusData1999.ts",
  "src/lib/seeds/jp/jpRegionCensusData2007.ts",
  "src/lib/seeds/jp/jpRegionCensusData2023.ts",
  "src/lib/seeds/jp/jpRegionDemographics.ts",
  "src/lib/seeds/jp/jpRegionDemographics1979.ts",
  "src/lib/seeds/jp/jpRegionDemographics1991.ts",
  "src/lib/seeds/jp/jpRegionDemographics1999.ts",
  "src/lib/seeds/jp/jpRegionDemographics2023.ts",
  "src/lib/seeds/jp/jpRegionVoteShares1990.ts",
  "src/lib/seeds/jp/jpRegions.ts",
  "src/lib/seeds/jp/jpRegions1953.ts",
  "src/lib/seeds/jp/jpRegions1979.ts",
  "src/lib/seeds/jp/jpRegions1991.ts",
  "src/lib/seeds/jp/jpRegions1999.ts",
  "src/lib/seeds/jp/jpRegions2007.ts",
  "src/lib/seeds/jp/jpRegions2023.ts",
  "src/lib/seeds/jp/jpStateBaselines.ts",
  "src/lib/seeds/jp/jpStateMetrics.ts",
  "src/lib/seeds/jp/jpStatePartyOrgCalculations.ts",
  "src/lib/seeds/wiki/content/jpOverview.ts",
  "src/lib/turn/billLifecycle/configs/jp.ts",
  "src/lib/turn/jpRegionalBudget.ts",
  "src/lib/turn/perpetualElections/countries/jp.ts",
];

/**
 * Japan content moves into `src/lib/countries/jp/`, but the file itself stays
 * and keeps its other countries.
 *
 * Bundle note: 41 of these are imported by at least one client component, so a
 * move must not drag a server-only import into a client bundle. That is a
 * per-phase check, not a bucket -- see E for where the line is drawn.
 *
 * CONTRADICTION TO RESOLVE: constants/historicalSeats.ts is listed here, meaning
 * its Japan content moves. The plan's D6 Step 3 picks the opposite default,
 * leaving the JP arrays in place and re-exporting them from the folder. One of
 * the two is wrong and the plan has not said which.
 */
export const BUCKET_A_MOVES: readonly string[] = [
  "src/app/api/country/[code]/region/[id]/budget/route.ts",
  "src/app/congress/bills/[id]/billHelpers.ts",
  "src/app/country/[code]/region/[id]/regionData.ts",
  "src/lib/admin/seed/seedSeats.ts",
  "src/lib/admin/seed/seedStateSectorSpecializations.ts",
  "src/lib/admin/seedDiagnostic/regionBundles.ts",
  "src/lib/admin/spawnNppCorporation.ts",
  "src/lib/archetypeAffinitiesIntl.ts",
  "src/lib/banking/npcBanks.ts",
  "src/lib/bucketAffinities.ts",
  "src/lib/budget/costs.ts",
  "src/lib/budget/regionalGrantField.ts",
  "src/lib/cabinetTransition.ts",
  "src/lib/commodity-map/commodityMapRegistry.ts",
  "src/lib/commodity-map/commodityRegionMappings.ts",
  "src/lib/constants.ts",
  "src/lib/constants/alignmentSeeds.ts",
  "src/lib/constants/cabinetEnergy.ts",
  "src/lib/constants/cabinetEstates.ts",
  "src/lib/constants/cabinetIdentity.ts",
  "src/lib/constants/cabinetInfra.ts",
  "src/lib/constants/cabinetMechanics.ts",
  "src/lib/constants/cabinetOrders.ts",
  "src/lib/constants/cabinetPositionGroups.ts",
  "src/lib/constants/countries.ts",
  "src/lib/constants/countryIso.ts",
  "src/lib/constants/countryReadinessExpectations.ts",
  "src/lib/constants/currencies.ts",
  "src/lib/constants/executiveSeals.ts",
  "src/lib/constants/executiveSurface.ts",
  "src/lib/constants/historicalSeats.ts",
  "src/lib/constants/institutionIdentity.ts",
  "src/lib/constants/internationalOrganizations.ts",
  "src/lib/constants/legalStructures.ts",
  "src/lib/constants/military.ts",
  "src/lib/constants/monetaryEra.ts",
  "src/lib/constants/nationalIdentity.ts",
  "src/lib/constants/nationalStatsIdentity.ts",
  "src/lib/constants/parliamentaryExecutiveSurface.ts",
  "src/lib/constants/stateAdjacency.ts",
  "src/lib/constants/states.ts",
  "src/lib/constants/turnTime.ts",
  "src/lib/crises/regionHazards.ts",
  "src/lib/demographics/bucketLabelsByCountry.ts",
  "src/lib/demographics/conscription.ts",
  "src/lib/demographics/countryDemographics.ts",
  "src/lib/demographics/substrateCoverage.ts",
  "src/lib/era/legislationCatalog.ts",
  "src/lib/era/legislationCostCatalog.ts",
  "src/lib/era/metricCatalog.ts",
  "src/lib/indexFunds/fundDefinitions.ts",
  "src/lib/indexFunds/nppInvesting.ts",
  "src/lib/legislationTypeAliases.ts",
  "src/lib/maps/countryAnchors.ts",
  "src/lib/military/theaters.ts",
  "src/lib/npp/generator.ts",
  "src/lib/npp/nameGenerator.ts",
  "src/lib/npp/nameLists1.ts",
  "src/lib/policy/nationalPolicyRecords.ts",
  "src/lib/policy/nationalStateId.ts",
  "src/lib/politicalMetrics/derive/defenseBoards1953.ts",
  "src/lib/politicalStrength/strengthConstants.ts",
  "src/lib/seeds/calibration/targets.ts",
  "src/lib/seeds/defaultPartyTiers.ts",
  "src/lib/seeds/metricPresets.ts",
  "src/lib/seeds/partySeedRegistry.ts",
  "src/lib/seeds/populationAnchors.ts",
  "src/lib/seeds/reference/basePolicies1953.ts",
  "src/lib/seeds/reference/basePolicies1979.ts",
  "src/lib/seeds/reference/basePolicies1991.ts",
  "src/lib/seeds/reference/basePolicies2019.ts",
  "src/lib/seeds/reference/budgets.ts",
  "src/lib/seeds/reference/gdpDenomination.ts",
  "src/lib/seeds/reference/moneySupply.ts",
  "src/lib/seeds/reference/ordersOfBattle.ts",
  "src/lib/seeds/reference/sectorSeedWeights.ts",
  "src/lib/seeds/reference/sectorSeedWeights1953.ts",
  "src/lib/seeds/reference/sectorSeedWeights1979.ts",
  "src/lib/seeds/reference/sectorSeedWeights1991.ts",
  "src/lib/seeds/reference/stateDemographics1991.ts",
  "src/lib/seeds/reference/stateResourceCapacity.ts",
  "src/lib/seeds/reference/strategicSectors.ts",
  "src/lib/seeds/reference/unionNames.ts",
  "src/lib/seeds/regionCensusData.ts",
  "src/lib/seeds/registration/registrationLanes.ts",
  "src/lib/seeds/registration/registrationLanes1991.ts",
  "src/lib/states/conditions/countryEra1991Patches.ts",
  "src/lib/states/conditions/countryPatches.ts",
  "src/lib/states/conditions/seedMetricsLoader.ts",
  "src/lib/treasury/payoutCapValues.ts",
  "src/lib/turn/countryPhases.ts",
  "src/lib/turn/gdpGrowth.ts",
  "src/lib/turn/partyOrg/pacingConstants.ts",
  "src/lib/turn/perpetualElections/registry.ts",
  "src/lib/utils/metricScoring.ts",
  "src/lib/world/countryReadinessContract.ts",
  "src/lib/world/worldEntityManifest.ts",
];

/**
 * Relational: the fact is BETWEEN countries, so a per-country copy drifts.
 * Exchange rates, reserve seeds, bloc alignment, cross-country ID allocation,
 * and region rosters -- regionTopology.ts maps JP to the East Asia theatre and
 * inverts that map into region-to-countries, so removing Japan changes East
 * Asia's roster.
 *
 * Several bucket-A files ALSO contain relational registries that must stay.
 * `currencies.ts` (INITIAL_RATES*) and `budgets.ts` (the two SOE base tables)
 * matter most. See the plan's bucket-B table.
 */
export const BUCKET_B_RELATIONAL: readonly string[] = [
  "src/app/api/admin/forex/seed-reserves/route.ts",
  "src/components/landing/blocColors.ts",
  "src/lib/military/regionTopology.ts",
  "src/lib/tariffs/reconcileTariffs.ts",
  "src/lib/utils/fxNormalize.ts",
];

/**
 * Derived, duplicated, or GENERATED. Fix the source; do not give Japan a second
 * copy.
 *
 * The three world routes each re-hardcode the ISO numeric code `countryIso.ts`
 * already owns. Three separate files duplicate the jp_ldp/jp_cdp display-name
 * map. `nationalScope.ts` is the inverse of NATIONAL_POLICY_STATE_IDS, whose own
 * comment reads "Single source of truth -- duplicated mappings elsewhere should
 * import this". `game/states/route.ts` computes JP_PLAYABLE_REGION_IDS straight
 * from JP_REGIONS.
 *
 * Three are emitter output carrying a do-not-edit header, and hand-moving them
 * creates a second source the next --emit silently reverts:
 * nonPlayableBoards.ts (41,827 LOC, keyed preset -> country -> region, so
 * country is not the first key), compositionWeights.generated.ts (4,563), and
 * approvalNeutrals.ts from the same generator. Their remedy is to change the
 * generator, not the artifact.
 */
export const BUCKET_C_DERIVED: readonly string[] = [
  "src/app/api/admin/heal/dropped-npp-parties/route.ts",
  "src/app/api/discord-bot/government/route.ts",
  "src/app/api/game/states/route.ts",
  "src/app/api/search/universal/route.ts",
  "src/app/api/world/corps/route.ts",
  "src/app/api/world/metrics/route.ts",
  "src/app/api/world/parties/route.ts",
  "src/app/world/conflicts/_coldwar/regionOverlayBridge.ts",
  "src/lib/constants/nationalScope.ts",
  "src/lib/demographics/compositionWeights.generated.ts",
  "src/lib/npp/seedHistorical.ts",
  "src/lib/politicalMetrics/seeds/approvalNeutrals.ts",
  "src/lib/politicalMetrics/seeds/nonPlayableBoards.ts",
  "src/lib/seeds/wiki/startingStateScenarios.ts",
];

/**
 * Client code, by a MECHANICAL rule: the file carries a "use client" directive,
 * OR every non-test file that imports it carries one.
 *
 * The second clause is the rule that was always meant, and stating it as
 * "imported by a client module" was wrong -- 41 of the bucket-A files satisfy
 * that, so it would have swallowed 38% of the move. Only-client-consumed is the
 * criterion that actually fits the original example,
 * parliamentaryCabinetConfig.ts: no directive of its own, two importers, both
 * client. Test importers are ignored, since a test says nothing about what ships
 * in a browser bundle.
 */
export const BUCKET_E_CLIENT: readonly string[] = [
  "src/app/congress/bills/[id]/components/TimelineStepper.tsx",
  "src/app/country/[code]/budget/NationalBudgetClient.tsx",
  "src/app/country/[code]/executive/cabinet/parliamentaryCabinetConfig.ts",
  "src/app/country/[code]/legislature/JPCabinetProposeBillModal.tsx",
  "src/app/country/[code]/legislature/JPDietPage.tsx",
  "src/app/country/[code]/legislature/LegislatureClient.tsx",
  "src/app/country/[code]/legislature/useJPDietPageState.ts",
  "src/app/country/[code]/map/components/countryMapConfigs.tsx",
  "src/app/country/[code]/parties/[id]/components/SlateTab.tsx",
  "src/app/country/[code]/parties/[id]/components/slate/stateMapData.ts",
  "src/app/create-character/page.tsx",
  "src/app/world/WorldMetricFilterContext.tsx",
  "src/components/CountryMapPaths.tsx",
  "src/components/JapanMapPaths.tsx",
  "src/components/admin/elections/ElectionFilterBar.tsx",
  "src/components/admin/elections/ElectionTimerForm.tsx",
  "src/components/admin/politics/NPPManagement.tsx",
  "src/components/admin/system/UniversalSeeder.tsx",
  "src/components/bills/BillTimeline.tsx",
  "src/components/landing/FlavorCardCarousel.tsx",
  "src/components/landing/globeEnhancements.ts",
  "src/components/positionEditor/PositionMapView.tsx",
  "src/components/wiki/widgets/SectorSeedMap.tsx",
  "src/components/wiki/widgets/StartingStateDashboardData.ts",
  "src/components/wiki/widgets/StartingStateSectorSpecialties.tsx",
  "src/lib/constants/countryContinents.ts",
  "src/lib/constants/economyIdentity.ts",
  "src/lib/constants/regionCensusLabels.ts",
  "src/lib/constants/treasuryIdentity.ts",
  "src/lib/legislature/process.ts",
];

/**
 * Country-conditional LOGIC only: a `case "JP":` branch, an `=== "JP"`
 * comparison, or a function-local per-country dispatch map with no registry
 * behind it. `demographicEffects.ts` and `policyEffects.ts` build
 * `{ US, UK, JP, DE }` inside a loop body; there is nothing there to move.
 * These get refactored to read a country capability.
 */
export const BUCKET_F_CONDITIONAL: readonly string[] = [
  "src/app/api/admin/elections/sync-date/route.ts",
  "src/app/api/admin/position-editor/preset/route.ts",
  "src/app/api/admin/seed/route.ts",
  "src/app/api/admin/setup/route.ts",
  "src/lib/billEnactment.ts",
  "src/lib/constants/regionBanner.ts",
  "src/lib/demographicEffects.ts",
  "src/lib/legislature/queries/nationalBillQueries.ts",
  "src/lib/policyEffects.ts",
  "src/lib/seeds/international/index.ts",
  "src/lib/states/regionalExecutive.ts",
  "src/lib/world/tier1ReadinessMatrix1953.ts",
];

/** Deliberately not handled by this plan. Each entry states why. */
export const ACKNOWLEDGED_OUT_OF_SCOPE: ReadonlyArray<{ file: string; why: string }> = [
  {
    file: "scripts/migrations/2026-05-18-backfill-bond-currency-code.mjs",
    why: "An applied one-shot migration. It records a past database state and is never re-run, so its Japan references are history rather than a live Japan surface.",
  },
  {
    file: "scripts/migrations/2026-05-18-drop-cash-on-hand.mjs",
    why: "An applied one-shot migration. It records a past database state and is never re-run, so its Japan references are history rather than a live Japan surface.",
  },
  {
    file: "scripts/migrations/2026-05-18-npp-funds-to-local.mjs",
    why: "An applied one-shot migration. It records a past database state and is never re-run, so its Japan references are history rather than a live Japan surface.",
  },
  {
    file: "scripts/migrations/2026-05-18-reconcile-cash-on-hand-orphans.mjs",
    why: "An applied one-shot migration. It records a past database state and is never re-run, so its Japan references are history rather than a live Japan surface.",
  },
  {
    file: "scripts/migrations/2026-05-18-treasury-to-local.mjs",
    why: "An applied one-shot migration. It records a past database state and is never re-run, so its Japan references are history rather than a live Japan surface.",
  },
  {
    file: "scripts/migrations/2026-05-19-treasury-plan-reserves-to-local.mjs",
    why: "An applied one-shot migration. It records a past database state and is never re-run, so its Japan references are history rather than a live Japan surface.",
  },
  {
    file: "scripts/migrations/2026-06-10-reconcile-gdp-ssot.mjs",
    why: "An applied one-shot migration. It records a past database state and is never re-run, so its Japan references are history rather than a live Japan surface.",
  },
  {
    file: "scripts/migrations/backfillStatePolicyScope.ts",
    why: "An applied one-shot migration. It records a past database state and is never re-run, so its Japan references are history rather than a live Japan surface.",
  },
  {
    file: "scripts/migrations/createGovernorOffices.ts",
    why: "An applied one-shot migration. It records a past database state and is never re-run, so its Japan references are history rather than a live Japan surface.",
  },
  {
    file: "scripts/migrations/deprecated/2026-05-07-set-legal-structure-defaults.ts",
    why: "An applied one-shot migration. It records a past database state and is never re-run, so its Japan references are history rather than a live Japan surface.",
  },
  {
    file: "scripts/migrations/heal-reverse-split-shareholders.ts",
    why: "An applied one-shot migration. It records a past database state and is never re-run, so its Japan references are history rather than a live Japan surface.",
  },
  {
    file: "scripts/migrations/reset-gdp-growth-to-baseline.ts",
    why: "An applied one-shot migration. It records a past database state and is never re-run, so its Japan references are history rather than a live Japan surface.",
  },
  {
    file: "scripts/migrations/reset-unemployment-to-baseline.ts",
    why: "An applied one-shot migration. It records a past database state and is never re-run, so its Japan references are history rather than a live Japan surface.",
  },
  {
    file: "scripts/migrations/seed-state-output-snapshots.ts",
    why: "An applied one-shot migration. It records a past database state and is never re-run, so its Japan references are history rather than a live Japan surface.",
  },
  {
    file: "scripts/migrations/splitCorporateTaxDomesticForeign.ts",
    why: "An applied one-shot migration. It records a past database state and is never re-run, so its Japan references are history rather than a live Japan surface.",
  },
  {
    file: "scripts/sim/checkpointReport.ts",
    why: "Simulation reporting harness under scripts/sim/. It reads Japan alongside every other country to produce balance reports and owns no Japan facts.",
  },
  {
    file: "scripts/sim/governanceStyleStandings.ts",
    why: "Simulation reporting harness under scripts/sim/. It reads Japan alongside every other country to produce balance reports and owns no Japan facts.",
  },
  {
    file: "src/app/api/country/[code]/region/[id]/metrics/[category]/[metricId]/route.ts",
    why: "Doc comments only, listing jp_national beside uk_national as national-scope id examples. The route branches on no country.",
  },
  {
    file: "src/lib/admin/seed/seedRegistrationLanes.ts",
    why: "JP: new Map() is an empty accumulator initialised for all 20-plus countries inside a function. It holds no Japan data, so there is nothing to snapshot or move.",
  },
  {
    file: "src/lib/budget/fiscalYear.ts",
    why: "A doc comment naming jp_local_allocation_tax as an example of region-funding legislation. No Japan payload or branch.",
  },
  {
    file: "src/lib/db/types/regionalBudget.ts",
    why: "Shared DB interface. Field names are country-neutral (residentTaxRevenue, nationalGrant) with JP only in doc comments, beside DE siblings; same shape as statePolicy.ts above. Splitting it is a src/lib/db/types schema change needing a migration plan.",
  },
  {
    file: "src/lib/db/types/statePolicy.ts",
    why: "A doc comment listing jp_national as a national-scope stateId example. The type itself is country-neutral.",
  },
  {
    file: "src/lib/seeds/de/deLegislationTypes.ts",
    why: "Germany's legislation file. The two JP mentions are comments cross-referencing Japanese equivalents for calibration.",
  },
  {
    file: "src/lib/seeds/reference/legislationTypes.ts",
    why: "One comment cross-referencing jp_regional_economic_development to explain a weight. The registry itself is country-neutral.",
  },
  {
    file: "src/lib/seeds/reference/policyOptionHelpers.ts",
    why: "Helper functions only. The JP mentions are doc comments pointing at policyOptionsJP(), whose payload lives in the JP policy seed.",
  },
  {
    file: "src/lib/seeds/wiki/content/createACharacter.ts",
    why: "Player-wiki prose. The JP mention sits inside a markdown string teaching region choice; there is no keyed Japan payload to move.",
  },
  {
    file: "src/lib/seeds/wiki/content/glossary.ts",
    why: "Player-wiki prose naming the Bank of Japan as a central-bank example; no keyed Japan payload.",
  },
  {
    file: "src/lib/seeds/wiki/content/multiCountryPlay.ts",
    why: "Player-wiki prose quoting the 233-seat majority; that seat count is owned by COUNTRY_CONFIGS and must be quoted from there, not moved.",
  },
  {
    file: "src/lib/turn/billLifecycle/types.ts",
    why: "Type declarations only. The JP mention is a doc-comment example of a stage side effect, not Japan data.",
  },
];
