/**
 * Where every Japan-bearing file in the tree is accounted for.
 *
 * WHY THIS FILE EXISTS: the country-folder plan maintained coverage by hand
 * across five uncross-checked places (bucket tables, per-phase file lists,
 * registry tables, count bullets, a self-review). Eight revisions each corrected
 * the last and reintroduced the same defect class, and the revision that finally
 * added a coverage *test* defined the test as the union of the same detection
 * heuristics that had been dropping files all along, so it would have reported
 * green over 44 percent of Japan.
 *
 * The denominator in jpCoverage.test.ts makes NO assumption about a registry's
 * type shape. It matches a Japan object key, so `Record<CountryId, X>`,
 * `Record<string, X>`, a narrowed alias and a composite `"JP:HOK"` key all count
 * equally. Heuristics may be used to FIND candidates; they may never define the
 * set. Adding a Japan-bearing file fails the test until it is classified.
 *
 * WHAT THE TEST GUARANTEES: that no Japan-bearing file goes unexamined. It does
 * NOT guarantee the bucket is the right one. That stays review-time judgement.
 *
 * Classification is per FILE, and several files hold registries of more than one
 * kind (`currencies.ts` carries COUNTRY_CURRENCY_MAP, which moves, beside
 * INITIAL_RATES*, which must not). A file sits in the bucket describing its
 * DOMINANT treatment; the per-symbol split lives in the plan's registry tables.
 *
 * Precedence when a file could sit in two buckets: E > out-of-scope > F > B > C > A.
 */

/**
 * Japan content moves into `src/lib/countries/jp/`.
 *
 * Bundle note: some of these are also imported by client components, so a move
 * must not drag a server-only import into a client bundle. That is a per-phase
 * check, not a separate bucket. E below is for files that ARE client code.
 */
export const BUCKET_A_MOVES: readonly string[] = [
  "src/app/api/admin/seed/route.ts",
  "src/app/api/country/[code]/region/[id]/budget/route.ts",
  "src/app/api/discord-bot/government/route.ts",
  "src/app/api/search/universal/route.ts",
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
  "src/lib/constants/military.ts",
  "src/lib/constants/monetaryEra.ts",
  "src/lib/constants/nationalIdentity.ts",
  "src/lib/constants/nationalStatsIdentity.ts",
  "src/lib/constants/parliamentaryExecutiveSurface.ts",
  "src/lib/constants/regionCensusLabels.ts",
  "src/lib/constants/stateAdjacency.ts",
  "src/lib/constants/treasuryIdentity.ts",
  "src/lib/crises/regionHazards.ts",
  "src/lib/demographicEffects.ts",
  "src/lib/demographics/bucketLabelsByCountry.ts",
  "src/lib/demographics/compositionWeights.generated.ts",
  "src/lib/demographics/conscription.ts",
  "src/lib/demographics/substrateCoverage.ts",
  "src/lib/era/legislationCostCatalog.ts",
  "src/lib/era/metricCatalog.ts",
  "src/lib/indexFunds/fundDefinitions.ts",
  "src/lib/indexFunds/nppInvesting.ts",
  "src/lib/legislature/process.ts",
  "src/lib/maps/countryAnchors.ts",
  "src/lib/military/regionTopology.ts",
  "src/lib/military/theaters.ts",
  "src/lib/npp/generator.ts",
  "src/lib/npp/nameGenerator.ts",
  "src/lib/policy/nationalPolicyRecords.ts",
  "src/lib/policy/nationalStateId.ts",
  "src/lib/politicalMetrics/derive/defenseBoards1953.ts",
  "src/lib/politicalMetrics/seeds/approvalNeutrals.ts",
  "src/lib/politicalMetrics/seeds/nonPlayableBoards.ts",
  "src/lib/politicalStrength/strengthConstants.ts",
  "src/lib/seeds/calibration/targets.ts",
  "src/lib/seeds/defaultPartyTiers.ts",
  "src/lib/seeds/jp/jpGovernmentFormation.ts",
  "src/lib/seeds/metricPresets.ts",
  "src/lib/seeds/partySeedRegistry.ts",
  "src/lib/seeds/populationAnchors.ts",
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
 * Derived or duplicated from another registry. Fix the duplication; do not give
 * Japan a second copy. The three world routes each re-hardcode the ISO numeric
 * code that `countryIso.ts` already owns.
 */
export const BUCKET_C_DERIVED: readonly string[] = [
  "src/app/api/world/corps/route.ts",
  "src/app/api/world/metrics/route.ts",
  "src/app/api/world/parties/route.ts",
  "src/components/landing/globeEnhancements.ts",
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
  "src/app/country/[code]/legislature/LegislatureClient.tsx",
  "src/app/country/[code]/map/components/countryMapConfigs.tsx",
  "src/app/world/WorldMetricFilterContext.tsx",
  "src/components/admin/elections/ElectionTimerForm.tsx",
  "src/components/landing/FlavorCardCarousel.tsx",
  "src/components/positionEditor/PositionMapView.tsx",
  "src/components/wiki/widgets/SectorSeedMap.tsx",
];

/**
 * Country-conditional LOGIC only, a `case "JP":` branch or Set membership with
 * no data payload. These get refactored to read a country capability, not moved.
 */
export const BUCKET_F_CONDITIONAL: readonly string[] = [
  "src/app/api/admin/position-editor/preset/route.ts",
  "src/lib/constants/regionBanner.ts",
  "src/lib/seeds/international/index.ts",
  "src/lib/states/regionalExecutive.ts",
];

/** Deliberately not handled by this plan. Each entry states why. */
export const ACKNOWLEDGED_OUT_OF_SCOPE: ReadonlyArray<{ file: string; why: string }> = [
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
