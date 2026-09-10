/**
 * Where every Japan-bearing file in the tree is accounted for.
 *
 * WHY THIS FILE EXISTS: the country-folder plan tracked Japan's footprint by
 * hand across five uncross-checked places. Eight revisions each corrected the
 * last and reintroduced the same defect class, and the revision that finally
 * proposed a coverage test defined it as the union of the same four detection
 * heuristics that had been dropping files all along.
 *
 * The first version of THIS file then made the same mistake one level up: it
 * replaced that union with a single heuristic, the JP object key, and promoted
 * it to ground truth. Measured, that missed 47 of the 48 Japan-NAMED source
 * files, roughly 17,000 LOC, because a file that *is* Japan carries no `JP:`
 * key. It also missed 32 files keyed `jp_<slug>` and 9 that branch on
 * `=== "JP"`. The denominator is now a union of four ground truths; see
 * jpCoverage.test.ts.
 *
 * WHAT THE TEST GUARANTEES: that no Japan-bearing file goes unexamined. It does
 * NOT guarantee the bucket is the right one. That stays review-time judgement.
 *
 * Classification is per FILE, and several files hold registries of more than one
 * kind (`currencies.ts` carries COUNTRY_CURRENCY_MAP, which moves, beside
 * INITIAL_RATES*, which must not). A file sits in the bucket describing its
 * DOMINANT treatment; the per-symbol split lives in the plan's registry tables.
 *
 * Precedence when a file could sit in two buckets: E > out-of-scope > F > B > C > D > A.
 * E outranks D because a Japan-named client component (JPDietPage.tsx) is a
 * route surface that stays where Next.js routing needs it; it does not relocate.
 */

/**
 * Already per-country: Japan-named modules that relocate wholesale into
 * `src/lib/countries/jp/`. The plan's largest concrete move, and the bucket the
 * key-only denominator could not see at all.
 *
 * Size note: jpLegislationTypes.ts is 6,169 LOC, well past the 2,000-line
 * blocking cap. SIZE_CAP_EXEMPT matches by SUBSTRING, so moving it out of
 * `seeds/jp/` strips its exemption unless the new path is added first.
 */
export const BUCKET_D_RELOCATE: readonly string[] = [
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
 * Bundle note: 60 of these are reachable from a "use client" root, so a move
 * must not drag a server-only import into a client bundle. That is a per-phase
 * check, not a bucket. A pure import-graph rule would swallow 58% of this list.
 */
export const BUCKET_A_MOVES: readonly string[] = [
  "src/app/api/country/[code]/region/[id]/budget/route.ts",
  "src/app/country/[code]/parties/[id]/components/slate/stateMapData.ts",
  "src/app/country/[code]/region/[id]/regionData.ts",
  "src/app/world/conflicts/_coldwar/regionOverlayBridge.ts",
  "src/components/wiki/widgets/StartingStateDashboardData.ts",
  "src/components/wiki/widgets/StartingStateSectorSpecialties.tsx",
  "src/lib/admin/seed/seedRegistrationLanes.ts",
  "src/lib/admin/seed/seedSeats.ts",
  "src/lib/admin/seed/seedStateSectorSpecializations.ts",
  "src/lib/admin/seedDiagnostic/regionBundles.ts",
  "src/lib/admin/spawnNppCorporation.ts",
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
  "src/lib/constants/countryContinents.ts",
  "src/lib/constants/countryIso.ts",
  "src/lib/constants/countryReadinessExpectations.ts",
  "src/lib/constants/currencies.ts",
  "src/lib/constants/economyIdentity.ts",
  "src/lib/constants/executiveSeals.ts",
  "src/lib/constants/executiveSurface.ts",
  "src/lib/constants/historicalSeats.ts",
  "src/lib/constants/institutionIdentity.ts",
  "src/lib/constants/internationalOrganizations.ts",
  "src/lib/constants/legalStructures.ts",
  "src/lib/constants/military.ts",
  "src/lib/constants/monetaryEra.ts",
  "src/lib/constants/nationalIdentity.ts",
  "src/lib/constants/nationalScope.ts",
  "src/lib/constants/nationalStatsIdentity.ts",
  "src/lib/constants/parliamentaryExecutiveSurface.ts",
  "src/lib/constants/regionCensusLabels.ts",
  "src/lib/constants/stateAdjacency.ts",
  "src/lib/constants/treasuryIdentity.ts",
  "src/lib/crises/regionHazards.ts",
  "src/lib/db/types/regionalBudget.ts",
  "src/lib/demographicEffects.ts",
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
  "src/lib/legislature/process.ts",
  "src/lib/maps/countryAnchors.ts",
  "src/lib/military/regionTopology.ts",
  "src/lib/military/theaters.ts",
  "src/lib/npp/generator.ts",
  "src/lib/npp/nameGenerator.ts",
  "src/lib/policy/nationalPolicyRecords.ts",
  "src/lib/policy/nationalStateId.ts",
  "src/lib/policyEffects.ts",
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
  "src/lib/seeds/registration/registrationLanes1991.ts",
  "src/lib/seeds/wiki/startingStateScenarios.ts",
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
 * Exchange rates, reserve seeds, bloc alignment, cross-country ID allocation.
 *
 * Several bucket-A files ALSO contain relational registries that must stay.
 * `currencies.ts` (INITIAL_RATES*) and `budgets.ts` (the two SOE base tables)
 * matter most. See the plan's bucket-B table.
 */
export const BUCKET_B_RELATIONAL: readonly string[] = [
  "src/app/api/admin/forex/seed-reserves/route.ts",
  "src/components/landing/blocColors.ts",
  "src/lib/tariffs/reconcileTariffs.ts",
  "src/lib/utils/fxNormalize.ts",
];

/**
 * Derived, duplicated, or GENERATED. Fix the source; do not give Japan a second
 * copy.
 *
 * The three world routes each re-hardcode the ISO numeric code `countryIso.ts`
 * already owns. Two files duplicate the jp_ldp/jp_cdp display-name map.
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
  "src/app/api/search/universal/route.ts",
  "src/app/api/world/corps/route.ts",
  "src/app/api/world/metrics/route.ts",
  "src/app/api/world/parties/route.ts",
  "src/components/landing/globeEnhancements.ts",
  "src/lib/demographics/compositionWeights.generated.ts",
  "src/lib/npp/seedHistorical.ts",
  "src/lib/politicalMetrics/seeds/approvalNeutrals.ts",
  "src/lib/politicalMetrics/seeds/nonPlayableBoards.ts",
];

/**
 * The file IS client code. Either it carries a "use client" directive, or (the
 * trap the audit caught) it carries none but is imported by a module that does.
 * `parliamentaryCabinetConfig.ts` is the second kind: no directive, imported by
 * CabinetClient.tsx, identical bundle hazard.
 */
export const BUCKET_E_CLIENT: readonly string[] = [
  "src/app/country/[code]/budget/NationalBudgetClient.tsx",
  "src/app/country/[code]/executive/cabinet/parliamentaryCabinetConfig.ts",
  "src/app/country/[code]/legislature/JPCabinetProposeBillModal.tsx",
  "src/app/country/[code]/legislature/JPDietPage.tsx",
  "src/app/country/[code]/legislature/LegislatureClient.tsx",
  "src/app/country/[code]/legislature/useJPDietPageState.ts",
  "src/app/country/[code]/map/components/countryMapConfigs.tsx",
  "src/app/country/[code]/parties/[id]/components/SlateTab.tsx",
  "src/app/world/WorldMetricFilterContext.tsx",
  "src/components/CountryMapPaths.tsx",
  "src/components/JapanMapPaths.tsx",
  "src/components/admin/elections/ElectionTimerForm.tsx",
  "src/components/admin/politics/NPPManagement.tsx",
  "src/components/admin/system/UniversalSeeder.tsx",
  "src/components/landing/FlavorCardCarousel.tsx",
  "src/components/positionEditor/PositionMapView.tsx",
  "src/components/wiki/widgets/SectorSeedMap.tsx",
];

/**
 * Country-conditional LOGIC only: a `case "JP":` branch, an `=== "JP"`
 * comparison, or set membership, with no data payload. These get refactored to
 * read a country capability, not moved.
 */
export const BUCKET_F_CONDITIONAL: readonly string[] = [
  "src/app/api/admin/elections/sync-date/route.ts",
  "src/app/api/admin/position-editor/preset/route.ts",
  "src/app/api/admin/seed/route.ts",
  "src/app/api/admin/setup/route.ts",
  "src/app/congress/bills/[id]/components/TimelineStepper.tsx",
  "src/lib/billEnactment.ts",
  "src/lib/constants/regionBanner.ts",
  "src/lib/legislature/queries/nationalBillQueries.ts",
  "src/lib/seeds/international/index.ts",
  "src/lib/states/regionalExecutive.ts",
  "src/lib/world/tier1ReadinessMatrix1953.ts",
];

/** Deliberately not handled by this plan. Each entry states why. */
export const ACKNOWLEDGED_OUT_OF_SCOPE: ReadonlyArray<{ file: string; why: string }> = [
  {
    file: "src/app/api/country/[code]/region/[id]/metrics/[category]/[metricId]/route.ts",
    why: "Doc comments only, listing jp_national beside uk_national as national-scope id examples. The route branches on no country.",
  },
  {
    file: "src/lib/budget/fiscalYear.ts",
    why: "A doc comment naming jp_local_allocation_tax as an example of region-funding legislation. No Japan payload or branch.",
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
