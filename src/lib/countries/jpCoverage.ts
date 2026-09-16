/**
 * Where every Japan-bearing file in the tree is accounted for, and which phase
 * of the country-folder plan owns it.
 *
 * WHY THIS FILE EXISTS: the plan tracked Japan's footprint by hand across five
 * uncross-checked places. Eight revisions each corrected the last and
 * reintroduced the same defect class. Three attempts at a mechanical guard then
 * repeated it at one remove:
 *
 *   - the first matched a JP object key alone, and missed 47 of the 48
 *     Japan-NAMED files (~17,000 LOC), because a file that *is* Japan carries
 *     no `JP:` key;
 *   - the second added Japan-named files, jp_<slug> keys and `=== "JP"`, and
 *     still missed constants/states.ts, which declares JP_SHUGIIN_SEATS (465),
 *     JP_SANGIIN_SEATS (248) and JP_GOVERNOR_SEATS -- Japan's canonical chamber
 *     seat tables -- under a name none of the four rules matched;
 *   - the third guarded MEMBERSHIP but not ASSIGNMENT, so 126 files could sit
 *     classified-but-unplanned while the suite stayed green. The streak had
 *     simply moved into the artifact next door.
 *
 * `phase` is a REQUIRED field. A file cannot be classified without being given
 * a phase, so "which phase moves this?" can no longer be answered by silence.
 *
 * WHAT THIS GUARANTEES: that no Japan-bearing file goes unexamined, and that
 * every one of them names an owning phase. It does NOT guarantee the bucket or
 * the phase is the RIGHT one. That stays review-time judgement.
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
 * A -- Japan content moves into `src/lib/countries/jp/`; the file stays and
 *      keeps its other countries.
 * B -- relational: the fact is BETWEEN countries, so a per-country copy drifts.
 *      Exchange rates, reserve seeds, bloc alignment, cross-country ID
 *      allocation, and region rosters. regionTopology.ts maps JP to the East
 *      Asia theatre and inverts that map, so removing Japan changes East Asia's
 *      roster.
 * C -- derived, duplicated, or GENERATED. Fix the source, do not add a copy.
 *      Three world routes re-hardcode the ISO numeric code countryIso.ts owns.
 *      Three files duplicate the jp_ldp/jp_cdp display-name map. nationalScope.ts
 *      inverts NATIONAL_POLICY_STATE_IDS, whose own comment calls itself the
 *      single source of truth. Three are emitter output with a do-not-edit
 *      header -- hand-moving them creates a second source the next --emit
 *      reverts, so the remedy is the generator, not the artifact.
 * D -- already per-country: Japan-named modules that relocate wholesale.
 *      jpLegislationTypes.ts is 6,169 LOC, past the 2,000-line blocking cap, and
 *      SIZE_CAP_EXEMPT matches by SUBSTRING -- moving it out of `seeds/jp/`
 *      strips its exemption unless the new path is added first.
 * E -- client code, by a MECHANICAL rule: carries a "use client" directive, OR
 *      every non-test importer does. "Imported by a client module" was never the
 *      real rule; 41 bucket-A files satisfy that. Only-client-consumed is what
 *      fits parliamentaryCabinetConfig.ts, the example the rule came from. Test
 *      importers are ignored -- a test says nothing about a browser bundle.
 * F -- country-conditional LOGIC only: a `case "JP":` branch, an `=== "JP"`
 *      comparison, or a function-local per-country dispatch map with no registry
 *      behind it. demographicEffects.ts and policyEffects.ts build
 *      `{ US, UK, JP, DE }` inside a loop body; there is nothing there to move.
 */
export type Bucket = "A" | "B" | "C" | "D" | "E" | "F";

/** The plan's phases. D8 is the gate, so no file is assigned to it. */
export type Phase = "D1" | "D2" | "D3" | "D4" | "D5" | "D6" | "D7" | "D8";

export interface CoverageEntry {
  readonly file: string;
  readonly bucket: Bucket;
  /** Which plan phase does this file's work. Required, so it cannot be skipped. */
  readonly phase: Phase;
  /**
   * "plan" -- the plan's own phase section names this file.
   * "derived" -- assigned here by topic rule because the plan never named it.
   *
   * 83 entries are "plan" and 126 are "derived". The split is
   * recorded rather than flattened because a derived assignment is a guess made
   * against a phase THEME, and the guesses are what a reviewer should read first.
   * Buckets B and F are uniformly D7: neither moves, and both are reconciliation
   * work (assert a relational registry, or replace a branch with a capability).
   */
  readonly source: "plan" | "derived";
}

/**
 * Every Japan-bearing file, its bucket, and its owning phase.
 *
 * Phase totals: D1 3, D2 17, D3 31, D4 23, D5 43, D6 64, D7 28.
 */
export const JP_COVERAGE: readonly CoverageEntry[] = [
  { file: "src/lib/seeds/reference/ordersOfBattle.ts", bucket: "A", phase: "D1", source: "plan" },
  {
    file: "src/lib/world/countryReadinessContract.ts",
    bucket: "A",
    phase: "D1",
    source: "derived",
  },
  {
    file: "src/lib/countries/jp/cabinet/positions.ts",
    bucket: "D",
    phase: "D3",
    source: "derived",
  },
  { file: "src/lib/countries/jp/cabinet/orders.ts", bucket: "D", phase: "D3", source: "derived" },
  {
    file: "src/lib/countries/jp/cabinet/mechanics.ts",
    bucket: "D",
    phase: "D3",
    source: "derived",
  },
  {
    file: "src/lib/countries/jp/elections/perpetual.ts",
    bucket: "D",
    phase: "D3",
    source: "derived",
  },
  {
    file: "src/lib/countries/jp/elections/billLifecycle.ts",
    bucket: "D",
    phase: "D3",
    source: "derived",
  },
  { file: "src/lib/seeds/international/jp.ts", bucket: "D", phase: "D1", source: "plan" },
  { file: "src/lib/banking/npcBanks.ts", bucket: "A", phase: "D2", source: "plan" },
  {
    file: "src/lib/commodity-map/commodityRegionMappings.ts",
    bucket: "A",
    phase: "D2",
    source: "plan",
  },
  { file: "src/lib/constants/cabinetIdentity.ts", bucket: "A", phase: "D2", source: "plan" },
  { file: "src/lib/constants/countries.ts", bucket: "A", phase: "D2", source: "plan" },
  { file: "src/lib/constants/executiveSeals.ts", bucket: "A", phase: "D2", source: "plan" },
  { file: "src/lib/constants/executiveSurface.ts", bucket: "A", phase: "D2", source: "plan" },
  { file: "src/lib/constants/institutionIdentity.ts", bucket: "A", phase: "D2", source: "plan" },
  { file: "src/lib/constants/nationalIdentity.ts", bucket: "A", phase: "D2", source: "plan" },
  { file: "src/lib/constants/nationalStatsIdentity.ts", bucket: "A", phase: "D2", source: "plan" },
  {
    file: "src/lib/constants/parliamentaryExecutiveSurface.ts",
    bucket: "A",
    phase: "D2",
    source: "plan",
  },
  {
    file: "src/app/api/discord-bot/government/route.ts",
    bucket: "C",
    phase: "D2",
    source: "derived",
  },
  { file: "src/app/api/search/universal/route.ts", bucket: "C", phase: "D2", source: "derived" },
  {
    file: "src/app/world/conflicts/_coldwar/regionOverlayBridge.ts",
    bucket: "C",
    phase: "D2",
    source: "derived",
  },
  {
    file: "src/components/landing/FlavorCardCarousel.tsx",
    bucket: "E",
    phase: "D2",
    source: "derived",
  },
  { file: "src/lib/constants/economyIdentity.ts", bucket: "E", phase: "D2", source: "plan" },
  { file: "src/lib/constants/regionCensusLabels.ts", bucket: "E", phase: "D2", source: "plan" },
  { file: "src/lib/constants/treasuryIdentity.ts", bucket: "E", phase: "D2", source: "plan" },
  {
    file: "src/app/congress/bills/[id]/billHelpers.ts",
    bucket: "A",
    phase: "D3",
    source: "derived",
  },
  { file: "src/lib/cabinetTransition.ts", bucket: "A", phase: "D3", source: "plan" },
  { file: "src/lib/constants/cabinetEnergy.ts", bucket: "A", phase: "D3", source: "plan" },
  { file: "src/lib/constants/cabinetEstates.ts", bucket: "A", phase: "D3", source: "plan" },
  { file: "src/lib/constants/cabinetInfra.ts", bucket: "A", phase: "D3", source: "plan" },
  { file: "src/lib/constants/cabinetMechanics.ts", bucket: "A", phase: "D3", source: "plan" },
  { file: "src/lib/constants/cabinetOrders.ts", bucket: "A", phase: "D3", source: "plan" },
  { file: "src/lib/constants/cabinetPositionGroups.ts", bucket: "A", phase: "D3", source: "plan" },
  {
    file: "src/lib/constants/internationalOrganizations.ts",
    bucket: "A",
    phase: "D3",
    source: "plan",
  },
  { file: "src/lib/constants/military.ts", bucket: "A", phase: "D3", source: "plan" },
  { file: "src/lib/constants/states.ts", bucket: "A", phase: "D3", source: "derived" },
  { file: "src/lib/constants/turnTime.ts", bucket: "A", phase: "D3", source: "derived" },
  { file: "src/lib/era/legislationCatalog.ts", bucket: "A", phase: "D3", source: "derived" },
  { file: "src/lib/legislationTypeAliases.ts", bucket: "A", phase: "D3", source: "derived" },
  { file: "src/lib/military/theaters.ts", bucket: "A", phase: "D3", source: "derived" },
  { file: "src/lib/turn/countryPhases.ts", bucket: "A", phase: "D3", source: "plan" },
  { file: "src/lib/turn/perpetualElections/registry.ts", bucket: "A", phase: "D3", source: "plan" },
  { file: "src/lib/constants/jpCabinet.ts", bucket: "D", phase: "D7", source: "plan" },
  { file: "src/lib/constants/jpCabinetMechanics.ts", bucket: "D", phase: "D7", source: "plan" },
  { file: "src/lib/constants/jpCabinetOrders.ts", bucket: "D", phase: "D7", source: "plan" },
  { file: "src/lib/turn/billLifecycle/configs/jp.ts", bucket: "D", phase: "D7", source: "plan" },
  {
    file: "src/lib/turn/perpetualElections/countries/jp.ts",
    bucket: "D",
    phase: "D7",
    source: "plan",
  },
  {
    file: "src/app/congress/bills/[id]/components/TimelineStepper.tsx",
    bucket: "E",
    phase: "D3",
    source: "derived",
  },
  {
    file: "src/app/country/[code]/executive/cabinet/parliamentaryCabinetConfig.ts",
    bucket: "E",
    phase: "D3",
    source: "plan",
  },
  {
    file: "src/app/country/[code]/legislature/JPCabinetProposeBillModal.tsx",
    bucket: "E",
    phase: "D3",
    source: "derived",
  },
  {
    file: "src/app/country/[code]/legislature/JPDietPage.tsx",
    bucket: "E",
    phase: "D3",
    source: "derived",
  },
  {
    file: "src/app/country/[code]/legislature/LegislatureClient.tsx",
    bucket: "E",
    phase: "D3",
    source: "derived",
  },
  {
    file: "src/components/admin/elections/ElectionFilterBar.tsx",
    bucket: "E",
    phase: "D3",
    source: "derived",
  },
  {
    file: "src/components/admin/elections/ElectionTimerForm.tsx",
    bucket: "E",
    phase: "D3",
    source: "derived",
  },
  { file: "src/components/bills/BillTimeline.tsx", bucket: "E", phase: "D3", source: "derived" },
  { file: "src/lib/legislature/process.ts", bucket: "E", phase: "D3", source: "plan" },
  {
    file: "src/app/api/country/[code]/region/[id]/budget/route.ts",
    bucket: "A",
    phase: "D4",
    source: "derived",
  },
  { file: "src/lib/budget/costs.ts", bucket: "A", phase: "D4", source: "plan" },
  { file: "src/lib/budget/regionalGrantField.ts", bucket: "A", phase: "D4", source: "derived" },
  { file: "src/lib/constants/currencies.ts", bucket: "A", phase: "D4", source: "plan" },
  { file: "src/lib/constants/legalStructures.ts", bucket: "A", phase: "D4", source: "derived" },
  { file: "src/lib/constants/monetaryEra.ts", bucket: "A", phase: "D4", source: "plan" },
  { file: "src/lib/era/legislationCostCatalog.ts", bucket: "A", phase: "D4", source: "plan" },
  { file: "src/lib/indexFunds/fundDefinitions.ts", bucket: "A", phase: "D4", source: "derived" },
  { file: "src/lib/indexFunds/nppInvesting.ts", bucket: "A", phase: "D4", source: "derived" },
  { file: "src/lib/policy/nationalPolicyRecords.ts", bucket: "A", phase: "D4", source: "plan" },
  { file: "src/lib/policy/nationalStateId.ts", bucket: "A", phase: "D4", source: "plan" },
  { file: "src/lib/seeds/reference/budgets.ts", bucket: "A", phase: "D4", source: "plan" },
  {
    file: "src/lib/seeds/reference/gdpDenomination.ts",
    bucket: "A",
    phase: "D4",
    source: "derived",
  },
  { file: "src/lib/seeds/reference/moneySupply.ts", bucket: "A", phase: "D4", source: "plan" },
  {
    file: "src/lib/seeds/reference/sectorSeedWeights.ts",
    bucket: "A",
    phase: "D4",
    source: "plan",
  },
  {
    file: "src/lib/seeds/reference/sectorSeedWeights1979.ts",
    bucket: "A",
    phase: "D4",
    source: "plan",
  },
  {
    file: "src/lib/seeds/reference/sectorSeedWeights1991.ts",
    bucket: "A",
    phase: "D4",
    source: "plan",
  },
  { file: "src/lib/seeds/reference/strategicSectors.ts", bucket: "A", phase: "D4", source: "plan" },
  { file: "src/lib/treasury/payoutCapValues.ts", bucket: "A", phase: "D4", source: "plan" },
  { file: "src/lib/turn/gdpGrowth.ts", bucket: "A", phase: "D4", source: "plan" },
  { file: "src/app/api/world/corps/route.ts", bucket: "C", phase: "D4", source: "derived" },
  {
    file: "scripts/migrations/fix-jp-sector-market-sizes.ts",
    bucket: "D",
    phase: "D4",
    source: "derived",
  },
  {
    file: "src/app/country/[code]/budget/NationalBudgetClient.tsx",
    bucket: "E",
    phase: "D4",
    source: "derived",
  },
  {
    file: "src/app/country/[code]/region/[id]/regionData.ts",
    bucket: "A",
    phase: "D5",
    source: "plan",
  },
  { file: "src/lib/admin/seed/seedSeats.ts", bucket: "A", phase: "D5", source: "plan" },
  {
    file: "src/lib/admin/seed/seedStateSectorSpecializations.ts",
    bucket: "A",
    phase: "D5",
    source: "plan",
  },
  {
    file: "src/lib/admin/seedDiagnostic/regionBundles.ts",
    bucket: "A",
    phase: "D5",
    source: "plan",
  },
  { file: "src/lib/admin/spawnNppCorporation.ts", bucket: "A", phase: "D5", source: "plan" },
  { file: "src/lib/archetypeAffinitiesIntl.ts", bucket: "A", phase: "D5", source: "derived" },
  { file: "src/lib/bucketAffinities.ts", bucket: "A", phase: "D5", source: "derived" },
  {
    file: "src/lib/commodity-map/commodityMapRegistry.ts",
    bucket: "A",
    phase: "D5",
    source: "plan",
  },
  { file: "src/lib/constants.ts", bucket: "A", phase: "D5", source: "plan" },
  { file: "src/lib/constants/countryIso.ts", bucket: "A", phase: "D5", source: "plan" },
  { file: "src/lib/constants/stateAdjacency.ts", bucket: "A", phase: "D5", source: "plan" },
  { file: "src/lib/crises/regionHazards.ts", bucket: "A", phase: "D5", source: "plan" },
  {
    file: "src/lib/demographics/bucketLabelsByCountry.ts",
    bucket: "A",
    phase: "D5",
    source: "derived",
  },
  { file: "src/lib/demographics/conscription.ts", bucket: "A", phase: "D5", source: "plan" },
  {
    file: "src/lib/demographics/countryDemographics.ts",
    bucket: "A",
    phase: "D5",
    source: "derived",
  },
  { file: "src/lib/demographics/substrateCoverage.ts", bucket: "A", phase: "D5", source: "plan" },
  { file: "src/lib/era/metricCatalog.ts", bucket: "A", phase: "D5", source: "plan" },
  { file: "src/lib/maps/countryAnchors.ts", bucket: "A", phase: "D5", source: "derived" },
  { file: "src/lib/seeds/calibration/targets.ts", bucket: "A", phase: "D5", source: "plan" },
  { file: "src/lib/seeds/metricPresets.ts", bucket: "A", phase: "D5", source: "plan" },
  { file: "src/lib/seeds/populationAnchors.ts", bucket: "A", phase: "D5", source: "plan" },
  {
    file: "src/lib/seeds/reference/sectorSeedWeights1953.ts",
    bucket: "A",
    phase: "D5",
    source: "plan",
  },
  {
    file: "src/lib/seeds/reference/stateDemographics1991.ts",
    bucket: "A",
    phase: "D5",
    source: "plan",
  },
  {
    file: "src/lib/seeds/reference/stateResourceCapacity.ts",
    bucket: "A",
    phase: "D5",
    source: "plan",
  },
  { file: "src/lib/seeds/reference/unionNames.ts", bucket: "A", phase: "D5", source: "plan" },
  { file: "src/lib/seeds/regionCensusData.ts", bucket: "A", phase: "D5", source: "plan" },
  {
    file: "src/lib/states/conditions/countryEra1991Patches.ts",
    bucket: "A",
    phase: "D5",
    source: "plan",
  },
  { file: "src/lib/states/conditions/countryPatches.ts", bucket: "A", phase: "D5", source: "plan" },
  {
    file: "src/lib/states/conditions/seedMetricsLoader.ts",
    bucket: "A",
    phase: "D5",
    source: "plan",
  },
  { file: "src/lib/turn/partyOrg/pacingConstants.ts", bucket: "A", phase: "D5", source: "plan" },
  { file: "src/lib/utils/metricScoring.ts", bucket: "A", phase: "D5", source: "derived" },
  { file: "src/lib/world/worldEntityManifest.ts", bucket: "A", phase: "D5", source: "plan" },
  { file: "src/app/api/game/states/route.ts", bucket: "C", phase: "D5", source: "derived" },
  {
    file: "src/lib/demographics/compositionWeights.generated.ts",
    bucket: "C",
    phase: "D5",
    source: "derived",
  },
  { file: "scripts/geo/build-japan-geo.mjs", bucket: "D", phase: "D5", source: "derived" },
  { file: "src/lib/maps/japanGeometry.ts", bucket: "D", phase: "D5", source: "derived" },
  {
    file: "src/lib/countries/jp/data/jpPopulationAnchors.ts",
    bucket: "D",
    phase: "D5",
    source: "derived",
  },
  {
    file: "src/app/country/[code]/map/components/countryMapConfigs.tsx",
    bucket: "E",
    phase: "D5",
    source: "derived",
  },
  {
    file: "src/app/country/[code]/parties/[id]/components/slate/stateMapData.ts",
    bucket: "E",
    phase: "D5",
    source: "derived",
  },
  { file: "src/components/CountryMapPaths.tsx", bucket: "E", phase: "D5", source: "derived" },
  { file: "src/components/JapanMapPaths.tsx", bucket: "E", phase: "D5", source: "derived" },
  {
    file: "src/components/positionEditor/PositionMapView.tsx",
    bucket: "E",
    phase: "D5",
    source: "derived",
  },
  { file: "src/lib/constants/countryContinents.ts", bucket: "E", phase: "D5", source: "plan" },
  { file: "src/lib/constants/alignmentSeeds.ts", bucket: "A", phase: "D6", source: "derived" },
  {
    file: "src/lib/constants/countryReadinessExpectations.ts",
    bucket: "A",
    phase: "D6",
    source: "plan",
  },
  { file: "src/lib/constants/historicalSeats.ts", bucket: "A", phase: "D6", source: "plan" },
  { file: "src/lib/npp/generator.ts", bucket: "A", phase: "D6", source: "derived" },
  { file: "src/lib/npp/nameGenerator.ts", bucket: "A", phase: "D6", source: "derived" },
  { file: "src/lib/npp/nameLists1.ts", bucket: "A", phase: "D6", source: "derived" },
  {
    file: "src/lib/politicalMetrics/derive/defenseBoards1953.ts",
    bucket: "A",
    phase: "D6",
    source: "derived",
  },
  {
    file: "src/lib/politicalStrength/strengthConstants.ts",
    bucket: "A",
    phase: "D6",
    source: "derived",
  },
  { file: "src/lib/seeds/defaultPartyTiers.ts", bucket: "A", phase: "D6", source: "derived" },
  { file: "src/lib/seeds/partySeedRegistry.ts", bucket: "A", phase: "D6", source: "plan" },
  {
    file: "src/lib/seeds/reference/basePolicies1953.ts",
    bucket: "A",
    phase: "D6",
    source: "derived",
  },
  {
    file: "src/lib/seeds/reference/basePolicies1979.ts",
    bucket: "A",
    phase: "D6",
    source: "derived",
  },
  {
    file: "src/lib/seeds/reference/basePolicies1991.ts",
    bucket: "A",
    phase: "D6",
    source: "derived",
  },
  {
    file: "src/lib/seeds/reference/basePolicies2019.ts",
    bucket: "A",
    phase: "D6",
    source: "derived",
  },
  {
    file: "src/lib/seeds/registration/registrationLanes.ts",
    bucket: "A",
    phase: "D6",
    source: "derived",
  },
  {
    file: "src/lib/seeds/registration/registrationLanes1991.ts",
    bucket: "A",
    phase: "D6",
    source: "derived",
  },
  {
    file: "src/app/api/admin/heal/dropped-npp-parties/route.ts",
    bucket: "C",
    phase: "D6",
    source: "derived",
  },
  { file: "src/app/api/world/parties/route.ts", bucket: "C", phase: "D6", source: "derived" },
  { file: "src/lib/npp/seedHistorical.ts", bucket: "C", phase: "D6", source: "derived" },
  {
    file: "src/lib/politicalMetrics/seeds/approvalNeutrals.ts",
    bucket: "C",
    phase: "D6",
    source: "derived",
  },
  {
    file: "src/lib/politicalMetrics/seeds/nonPlayableBoards.ts",
    bucket: "C",
    phase: "D6",
    source: "derived",
  },
  {
    file: "src/lib/seeds/wiki/startingStateScenarios.ts",
    bucket: "C",
    phase: "D6",
    source: "derived",
  },
  { file: "scripts/seed/seed-jp.ts", bucket: "D", phase: "D6", source: "plan" },
  { file: "src/lib/admin/seed/seedJP.ts", bucket: "D", phase: "D6", source: "plan" },
  { file: "src/lib/admin/seed/seedJpBudgets.ts", bucket: "D", phase: "D6", source: "plan" },
  { file: "src/lib/countries/jp/data/jpBudgets.ts", bucket: "D", phase: "D6", source: "derived" },
  {
    file: "src/lib/countries/jp/data/jpCorporations.ts",
    bucket: "D",
    phase: "D6",
    source: "derived",
  },
  {
    file: "src/lib/countries/jp/data/jpDemographicCategories.ts",
    bucket: "D",
    phase: "D6",
    source: "derived",
  },
  {
    file: "src/lib/countries/jp/data/jpDemographicTurnout.ts",
    bucket: "D",
    phase: "D6",
    source: "derived",
  },
  {
    file: "src/lib/countries/jp/data/jpGovernmentFormation.ts",
    bucket: "D",
    phase: "D6",
    source: "derived",
  },
  {
    file: "src/lib/countries/jp/data/jpLegislationTypes.ts",
    bucket: "D",
    phase: "D6",
    source: "plan",
  },
  {
    file: "src/lib/countries/jp/data/jpMetricPresets.ts",
    bucket: "D",
    phase: "D6",
    source: "derived",
  },
  {
    file: "src/lib/countries/jp/data/jpMetricPresets1953.ts",
    bucket: "D",
    phase: "D6",
    source: "derived",
  },
  {
    file: "src/lib/countries/jp/data/jpMetricPresets1979.ts",
    bucket: "D",
    phase: "D6",
    source: "derived",
  },
  { file: "src/lib/countries/jp/data/jpParties.ts", bucket: "D", phase: "D6", source: "derived" },
  {
    file: "src/lib/countries/jp/data/jpRegionCensusData.ts",
    bucket: "D",
    phase: "D6",
    source: "derived",
  },
  {
    file: "src/lib/countries/jp/data/jpRegionCensusData1953.ts",
    bucket: "D",
    phase: "D6",
    source: "derived",
  },
  {
    file: "src/lib/countries/jp/data/jpRegionCensusData1979.ts",
    bucket: "D",
    phase: "D6",
    source: "derived",
  },
  {
    file: "src/lib/countries/jp/data/jpRegionCensusData1991.ts",
    bucket: "D",
    phase: "D6",
    source: "derived",
  },
  {
    file: "src/lib/countries/jp/data/jpRegionCensusData1999.ts",
    bucket: "D",
    phase: "D6",
    source: "derived",
  },
  {
    file: "src/lib/countries/jp/data/jpRegionCensusData2007.ts",
    bucket: "D",
    phase: "D6",
    source: "derived",
  },
  {
    file: "src/lib/countries/jp/data/jpRegionCensusData2023.ts",
    bucket: "D",
    phase: "D6",
    source: "derived",
  },
  {
    file: "src/lib/countries/jp/data/jpRegionDemographics.ts",
    bucket: "D",
    phase: "D6",
    source: "derived",
  },
  {
    file: "src/lib/countries/jp/data/jpRegionDemographics1979.ts",
    bucket: "D",
    phase: "D6",
    source: "derived",
  },
  {
    file: "src/lib/countries/jp/data/jpRegionDemographics1991.ts",
    bucket: "D",
    phase: "D6",
    source: "derived",
  },
  {
    file: "src/lib/countries/jp/data/jpRegionDemographics1999.ts",
    bucket: "D",
    phase: "D6",
    source: "derived",
  },
  {
    file: "src/lib/countries/jp/data/jpRegionDemographics2023.ts",
    bucket: "D",
    phase: "D6",
    source: "derived",
  },
  {
    file: "src/lib/countries/jp/data/jpRegionVoteShares1990.ts",
    bucket: "D",
    phase: "D6",
    source: "derived",
  },
  { file: "src/lib/countries/jp/data/jpRegions.ts", bucket: "D", phase: "D6", source: "derived" },
  {
    file: "src/lib/countries/jp/data/jpRegions1953.ts",
    bucket: "D",
    phase: "D6",
    source: "derived",
  },
  {
    file: "src/lib/countries/jp/data/jpRegions1979.ts",
    bucket: "D",
    phase: "D6",
    source: "derived",
  },
  {
    file: "src/lib/countries/jp/data/jpRegions1991.ts",
    bucket: "D",
    phase: "D6",
    source: "derived",
  },
  {
    file: "src/lib/countries/jp/data/jpRegions1999.ts",
    bucket: "D",
    phase: "D6",
    source: "derived",
  },
  {
    file: "src/lib/countries/jp/data/jpRegions2007.ts",
    bucket: "D",
    phase: "D6",
    source: "derived",
  },
  {
    file: "src/lib/countries/jp/data/jpRegions2023.ts",
    bucket: "D",
    phase: "D6",
    source: "derived",
  },
  {
    file: "src/lib/countries/jp/data/jpStateBaselines.ts",
    bucket: "D",
    phase: "D6",
    source: "derived",
  },
  {
    file: "src/lib/countries/jp/data/jpStateMetrics.ts",
    bucket: "D",
    phase: "D6",
    source: "derived",
  },
  {
    file: "src/lib/countries/jp/data/jpStatePartyOrgCalculations.ts",
    bucket: "D",
    phase: "D6",
    source: "derived",
  },
  { file: "src/lib/seeds/wiki/content/jpOverview.ts", bucket: "D", phase: "D6", source: "derived" },
  {
    file: "src/app/country/[code]/legislature/useJPDietPageState.ts",
    bucket: "E",
    phase: "D6",
    source: "plan",
  },
  {
    file: "src/app/country/[code]/parties/[id]/components/SlateTab.tsx",
    bucket: "E",
    phase: "D6",
    source: "derived",
  },
  {
    file: "src/components/wiki/widgets/SectorSeedMap.tsx",
    bucket: "E",
    phase: "D6",
    source: "plan",
  },
  {
    file: "src/components/wiki/widgets/StartingStateDashboardData.ts",
    bucket: "E",
    phase: "D6",
    source: "derived",
  },
  {
    file: "src/components/wiki/widgets/StartingStateSectorSpecialties.tsx",
    bucket: "E",
    phase: "D6",
    source: "derived",
  },
  {
    file: "src/app/api/admin/forex/seed-reserves/route.ts",
    bucket: "B",
    phase: "D7",
    source: "derived",
  },
  { file: "src/components/landing/blocColors.ts", bucket: "B", phase: "D7", source: "derived" },
  { file: "src/lib/military/regionTopology.ts", bucket: "B", phase: "D7", source: "derived" },
  { file: "src/lib/tariffs/reconcileTariffs.ts", bucket: "B", phase: "D7", source: "derived" },
  { file: "src/lib/utils/fxNormalize.ts", bucket: "B", phase: "D7", source: "derived" },
  { file: "src/app/api/world/metrics/route.ts", bucket: "C", phase: "D7", source: "derived" },
  { file: "src/lib/constants/nationalScope.ts", bucket: "C", phase: "D7", source: "derived" },
  {
    file: "scripts/migrations/backfill-jp-sangiin-seat-ids.ts",
    bucket: "D",
    phase: "D7",
    source: "derived",
  },
  { file: "src/lib/constants/japan.ts", bucket: "D", phase: "D7", source: "derived" },
  { file: "src/lib/events/pree/handlers/jpEvents.ts", bucket: "D", phase: "D7", source: "derived" },
  { file: "src/lib/turn/jpRegionalBudget.ts", bucket: "D", phase: "D7", source: "derived" },
  { file: "src/app/create-character/page.tsx", bucket: "E", phase: "D7", source: "derived" },
  {
    file: "src/app/world/WorldMetricFilterContext.tsx",
    bucket: "E",
    phase: "D7",
    source: "derived",
  },
  {
    file: "src/components/admin/politics/NPPManagement.tsx",
    bucket: "E",
    phase: "D7",
    source: "derived",
  },
  {
    file: "src/components/admin/system/UniversalSeeder.tsx",
    bucket: "E",
    phase: "D7",
    source: "derived",
  },
  {
    file: "src/components/landing/globeEnhancements.ts",
    bucket: "E",
    phase: "D7",
    source: "derived",
  },
  {
    file: "src/app/api/admin/elections/sync-date/route.ts",
    bucket: "F",
    phase: "D7",
    source: "derived",
  },
  {
    file: "src/app/api/admin/position-editor/preset/route.ts",
    bucket: "F",
    phase: "D7",
    source: "derived",
  },
  { file: "src/app/api/admin/seed/route.ts", bucket: "F", phase: "D7", source: "derived" },
  { file: "src/app/api/admin/setup/route.ts", bucket: "F", phase: "D7", source: "derived" },
  { file: "src/lib/billEnactment.ts", bucket: "F", phase: "D7", source: "derived" },
  { file: "src/lib/constants/regionBanner.ts", bucket: "F", phase: "D7", source: "derived" },
  { file: "src/lib/demographicEffects.ts", bucket: "F", phase: "D7", source: "derived" },
  {
    file: "src/lib/legislature/queries/nationalBillQueries.ts",
    bucket: "F",
    phase: "D7",
    source: "derived",
  },
  { file: "src/lib/policyEffects.ts", bucket: "F", phase: "D7", source: "derived" },
  { file: "src/lib/seeds/international/index.ts", bucket: "F", phase: "D7", source: "derived" },
  { file: "src/lib/states/regionalExecutive.ts", bucket: "F", phase: "D7", source: "derived" },
  {
    file: "src/lib/world/tier1ReadinessMatrix1953.ts",
    bucket: "F",
    phase: "D7",
    source: "derived",
  },
];

/** Deliberately not handled by this plan, so no phase. Each entry states why. */
export const ACKNOWLEDGED_OUT_OF_SCOPE: ReadonlyArray<{ file: string; why: string }> = [
  {
    file: "scripts/countries/verify-jp-runtime.ts",
    why: "Created by D3 to prove every forwarded registry resolves at runtime. A circular import typechecks cleanly and yields undefined, so this runs outside vitest to exercise the app's own module-init order. It owns no Japan fact.",
  },
  {
    file: "scripts/countries/audit-jp-snapshot.ts",
    why: "Created by D3 to audit the fixture for entries whose functions were dropped silently. It reads the snapshot and reports; it owns no Japan fact and writes nothing.",
  },
  {
    file: "scripts/countries/correct-jp-snapshot.ts",
    why: "Created by D3 to repair three entries the D1 extractor recorded incompletely. It rewrites only those three, only while their registries still hold pre-move values, and owns no Japan fact itself.",
  },
  {
    file: "scripts/countries/append-jp-snapshot.ts",
    why: "Created by D3 to append registries the original emitter missed. It reads registries that have not moved yet and owns no Japan fact itself; the plan forbids re-emitting the fixture, so appending is the only sanctioned path.",
  },
  {
    file: "scripts/countries/emit-jp-snapshot.ts",
    why: "Created by D1 as the one-off snapshot emitter. It reads every registry Japan will move but owns no Japan fact itself, so there is nothing to relocate.",
  },
  {
    file: "src/lib/countries/contract.ts",
    why: "Created by D1 as the declared shape of a country folder. It is the destination of the move, not a source of Japan facts.",
  },
  {
    file: "src/lib/countries/jp/eras/1953.ts",
    why: "Created by D3 as Japan's 1953 era override. Holds differences only, generated from the pre-move snapshot; it is where Japan's era facts now live.",
  },
  {
    file: "src/lib/countries/jp/eras/1979.ts",
    why: "Created by D3 as Japan's 1979 era override. Holds differences only, generated from the pre-move snapshot; it is where Japan's era facts now live.",
  },
  {
    file: "src/lib/countries/jp/eras/1991.ts",
    why: "Created by D3 as Japan's 1991 era override. Holds differences only, generated from the pre-move snapshot; it is where Japan's era facts now live.",
  },
  {
    file: "src/lib/countries/jp/eras/1999.ts",
    why: "Created by D3 as Japan's 1999 era override. Holds differences only, generated from the pre-move snapshot; it is where Japan's era facts now live.",
  },
  {
    file: "src/lib/countries/jp/eras/2007.ts",
    why: "Created by D3 as Japan's 2007 era override. Holds differences only, generated from the pre-move snapshot; it is where Japan's era facts now live.",
  },
  {
    file: "src/lib/countries/jp/eras/2019.ts",
    why: "Created by D3 as Japan's 2019 era override. Holds differences only, generated from the pre-move snapshot; it is where Japan's era facts now live.",
  },
  {
    file: "src/lib/countries/jp/eras/2023.ts",
    why: "Created by D3 as Japan's 2023 era override. Holds differences only, generated from the pre-move snapshot; it is where Japan's era facts now live.",
  },
  {
    file: "src/lib/countries/jp/eras/index.ts",
    why: "Created by D3 as the barrel over Japan's seven era overrides. Composes the era modules and owns no Japan fact of its own.",
  },
  {
    file: "src/lib/countries/jp/layer1Model.ts",
    why: "Absorbed by D6 from seeds/international/jp.ts, with a forwarder left behind. Japan's Layer-1 demographic model; the other 39 countries' files in that convention are deliberately untouched.",
  },
  {
    file: "src/lib/countries/jp/seed.ts",
    why: "Absorbed by D6 from admin/seed/seedJP.ts, with a forwarder left behind. Japan's seed runner, which a prefix-anchored search for jp* missed because the name is seedJP.",
  },
  {
    file: "src/lib/countries/jp/seedBudgets.ts",
    why: "Absorbed by D6 from admin/seed/seedJpBudgets.ts, with a forwarder left behind. Japan's budget seeder.",
  },
  {
    file: "src/lib/countries/jp/geography.ts",
    why: "Created by D5 as the destination for Japan's geography, regions and demographics. Composes the bulk payloads from data/ and holds the smaller registries inline.",
  },
  {
    file: "src/lib/countries/jp/economy.ts",
    why: "Created by D4 as the destination for Japan's economy and fiscal constants. Generated from the pre-move snapshot because these are balance surfaces; hand-copying a fourteen-digit GDP anchor is how a balance change arrives disguised as a refactor.",
  },
  {
    file: "src/lib/countries/jp/elections.ts",
    why: "Created by D3 as the destination for Japan's elections. Server-only: it reaches getDb through elections/perpetual.ts, so it is deliberately not re-exported from the folder barrel.",
  },
  {
    file: "src/lib/countries/jp/institutions.ts",
    why: "Created by D3 as the destination for Japan's institutions. Generated from the pre-move snapshot for authored tables and composed by import for the relocated cabinet data, so it is where Japan's facts now live.",
  },
  {
    file: "src/lib/countries/jp/identity.ts",
    why: "Created by D2 as the destination for Japan's names and labels. Generated from the pre-move snapshot, so it is where Japan's facts now live rather than a source still awaiting relocation.",
  },
  {
    file: "src/lib/countries/jp/index.ts",
    why: "Created by D1 as Japan's folder barrel. It is the destination of the move, not a source of Japan facts.",
  },
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

const filesIn = (bucket: Bucket): readonly string[] =>
  JP_COVERAGE.filter((e) => e.bucket === bucket).map((e) => e.file);

/** Files whose Japan content moves into the folder while the file stays. */
export const BUCKET_A_MOVES = filesIn("A");
/** Relational registries that must NOT get a per-country copy. */
export const BUCKET_B_RELATIONAL = filesIn("B");
/** Derived, duplicated, or generated. Fix the source. */
export const BUCKET_C_DERIVED = filesIn("C");
/** Japan-named modules that relocate wholesale. */
export const BUCKET_D_RELOCATE = filesIn("D");
/** Client code, by the only-client-consumed rule. */
export const BUCKET_E_CLIENT = filesIn("E");
/** Country-conditional logic with no payload. */
export const BUCKET_F_CONDITIONAL = filesIn("F");

/** Files owned by one phase, in bucket order. */
export function filesForPhase(phase: Phase): readonly CoverageEntry[] {
  return JP_COVERAGE.filter((e) => e.phase === phase);
}
