/**
 * Which countries have been converted to a folder, and which of their data files
 * are allowed to live outside it.
 *
 * WHY THIS EXISTS, AND WHY IT IS NOT `jpCoverage.ts`.
 *
 * The coverage roster classifies every Japan-bearing file into a bucket and a
 * phase. It is a good record and it caught real omissions, but it answers the
 * wrong question for the remaining countries, in two ways.
 *
 * It does not scale. It is ~1,100 lines for ONE country, and the denominator is
 * "every file that mentions Japan" -- 121 files. Twenty-four countries of that
 * shape is an artifact nobody maintains, and it already rots in practice: two
 * scripts added in this session had to be hand-registered in it before the suite
 * would go green, neither of which holds a single Japanese fact.
 *
 * ⚠ AND IT CHECKS CLASSIFICATION, NOT RELOCATION -- which is how the thing it
 * was built to prevent happened anyway. A file can sit in the roster marked
 * `bucket: "D"` (relocate wholesale) against a phase that has since COMPLETED,
 * while the file has never moved, and every test stays green. Measured against
 * Japan, a country declared finished, three files were in exactly that state:
 *
 *     src/lib/events/pree/handlers/jpEvents.ts      bucket D, phase D7, 461 lines
 *     src/lib/turn/jpRegionalBudget.ts              bucket D, phase D7, 333 lines
 *     src/lib/seeds/wiki/content/jpOverview.ts      bucket D, phase D6, 215 lines
 *
 * That is `src/lib/constants/japan.ts` -- classified bucket D for D7, missed,
 * and found only by hand afterwards -- happening three more times, for about a
 * thousand lines, with a mechanical guard supposedly watching. Saying "this file
 * should move" is not the same as checking that it did.
 *
 * So this file asks the narrower question that can actually be enforced:
 *
 *     for a country that has been converted, does every file holding that
 *     country's data live in that country's folder?
 *
 * ⚠ A COUNTRY ONLY COUNTS ONCE IT IS IN `CONVERTED`. Adding it there is what
 * makes the guard bite, and it should be the LAST step of converting a country,
 * not the first. The remaining countries are not failures, they are a backlog;
 * the test prints their sizes so the backlog stays visible instead of silent.
 */

/** Countries whose folder is finished. Adding one turns the guard on for it. */
export const CONVERTED: readonly string[] = [
  "JP",
  "US",
  "UK",
  "DE",
  "CN",
  "IE",
  "RU",
  "DD",
  "NG",
  "BR",
  "FR",
  "IT",
  "ES",
  "SE",
  "TR",
  "GR",
  "AT",
  "FI",
  "PL",
  "HU",
  "RO",
  "YU",
  "BG",
  "CS",
  "SCO",
  "WAL",
  "BLR",
  "UKR",
  "BAL",
];

/**
 * Files that hold one country's data, are NOT in that country's folder, and are
 * allowed to stay there. Every entry states why.
 *
 * ⚠ "IT WOULD BE AWKWARD TO MOVE" IS NOT A REASON. The three files listed in
 * this module's header each had a plausible-sounding excuse available and each
 * one was simply a miss. A reason here should say why the file is not the
 * country's data to own -- because it is a re-export shim, a client surface, a
 * build script, or data genuinely shared with the rest of the world -- or it
 * should name the decision and who made it.
 */
export const ACKNOWLEDGED_OUTSIDE: ReadonlyArray<{
  readonly file: string;
  readonly country: string;
  readonly why: string;
}> = [
  // ⚠ NO SHIM ENTRIES HERE. Japan leaves twelve forwarders behind and they used
  // to be listed one by one. They are now RECOGNISED instead: `isCountryFolderShim`
  // in the test accepts a file whose every statement, comments stripped, is an
  // `export * from` or bare `import` pointing into `@/lib/countries/`. A forwarder
  // holds no copy, so it is not the country's data by definition -- it is the
  // absence of a second one.
  //
  // Listing them would have meant roughly 250 entries across 24 countries whose
  // only content is "this is a shim", and an artifact of that shape is exactly
  // what `jpCoverage.ts` proved nobody maintains. The check is deliberately
  // strict: a file that forwards AND declares something of its own is not a shim
  // and still has to be justified below.

  // ---- Shared modules that CONTAINED one country's data without BEING it. ----
  //
  // ⚠️ EMPTY BECAUSE THE SLICES WERE EXTRACTED, NOT BECAUSE THE CASE STOPPED
  // EXISTING. Three files were parked here: `demographicCategories.ts`,
  // `primaryCalendar.ts` and `seeds/reference/politicalParties.ts`. Each held
  // United States data inside machinery every country reads, so neither moving
  // the file nor leaving it was right.
  //
  // They were split instead. The US halves are `us/data/usDemographicPositions.ts`,
  // `usPrimaryCalendar.ts` and `usParties.ts`; the shared halves keep their
  // exports and forward, so no consumer moved and `===` still finds one
  // definition of every table.
  //
  // A file belongs here only while its country's slice genuinely cannot be
  // separated yet, and the reason must name the shared exports so the entry goes
  // false the day they part company.

  // ---- Engine code that BRANCHES on the United States. Bucket F, not D. ----
  //
  // ⚠️ These are turn processors and election machinery, not tables of US facts.
  // They mention the US because it is the default country or because the mechanic
  // is American in origin; the logic is the file's content. Relocating a turn
  // phase into a country folder would move CODE, not data, and leave the engine
  // reaching into `us/` to run a turn.

  // ---- Wiki pages about the game, not about one country. ----

  // ---- United Kingdom: shared machinery and engine code. ----
  {
    file: "src/lib/constants/devolution.ts",
    country: "UK",
    why: "The devolution and secession machinery. It is written around the UK because the UK is the game's devolved state, but Scotland and Wales are separate countries in it -- SCO and WAL have their own ids -- so this is a multi-entity mechanic, not one country's table.",
  },
  {
    file: "src/lib/livingConflict/northernIrelandRatification.ts",
    country: "IE",
    why: "The bilateral ratification reconciler reads British and Irish legislation into one shared peace-process state. It is conflict-engine code jointly owned by both governments, not Ireland-only data.",
  },

  // ---- Shared modules that CONTAIN United States data without BEING it. ----
  //
  // ⚠️ Each of these is bucket A, not bucket D: the country's VALUES could move,
  // the FILE cannot, because its other half is machinery every country reads.
  // The reason names the shared exports, so the entry goes false the day they
  // part company.
  {
    file: "src/lib/demographics/countryDemographics.ts",
    country: "US",
    why: "Nine exports of cross-country machinery -- getDemographicCategoriesForCountry, resolveCanvassGroup, CanvassGroup, CanvassCategory -- which every country's canvassing reads. The US appears only as the default branch.",
  },
  {
    file: "src/lib/constants/sectorSeedEra.ts",
    country: "US",
    why: "Mixed: US_NATIONAL_SEED_GDP_BY_ERA is United States data, while getEraNominalScale and MODERN_MIN_UNOWNED_SECTOR_REVENUE are the era-scaling machinery every country's sector seeding runs through. Bucket A: the GDP table moves, the scaler stays.",
  },
  {
    file: "src/lib/constants/cabinetMetrics.ts",
    country: "US",
    why: "MetricFormat, CabinetMetricEntry and getCabinetMetrics are the cabinet metric machinery; CABINET_METRIC_MAPPINGS carries US rows inside it. Bucket A: the rows move once the reader is country-keyed, the types and the getter stay.",
  },
  {
    file: "src/lib/demographics/eraCheckpoints.ts",
    country: "US",
    why: "Twenty-one exports. EraCheckpointTarget, EraCheckpoint and DocketCaseLookupEntry are shared types; ALL_US_STATES, MIDWEST_STATES and SOUTH are United States groupings. Bucket A: the groupings move, the types stay.",
  },
  {
    file: "src/lib/demographics/regionTurnout.ts",
    country: "US",
    why: "RegionTurnoutCell and RegionTurnoutResponse are the shared turnout response shape, read by every country's region pages.",
  },
  {
    file: "src/lib/seeds/calibration/deriveRegionLeans.ts",
    country: "US",
    why: "One exported function, deriveRegionLeans. Engine code that happens to default to the US, not a table of US facts.",
  },

  // ---- United States client surfaces. Bucket E: they RENDER it, they do not own it. ----
  {
    file: "src/lib/maps/usaGeometry.ts",
    country: "US",
    why: "Projection parameters beside every other country's, so the map registry reads one directory rather than 24 folders. Same reasoning as japanGeometry.ts.",
  },

  // ---- Client surfaces. Bucket E: these RENDER the country, they do not own it. ----

  // ---- Tooling. Scripts ABOUT a country are not that country's data. ----
  {
    file: "src/lib/maps/japanGeometry.ts",
    country: "JP",
    why: "Projection parameters beside every other country's, so the map registry reads one directory rather than 24 folders.",
  },

  // ---- Deferred by decision, with the decision named. ----
  //
  // ⚠ EMPTY, AND IT SHOULD STAY HARD TO ADD TO. It held Japan's two
  // non-player-politician rosters, deferred because "moving it now would widen a
  // merge into a fresh migration". That was true while the merge from
  // origin/development was in flight and stale the moment `b1605b15b` landed --
  // and nothing re-read it, which is exactly how a deferral turns permanent. The
  // two rosters (2,324 lines) are now in `jp/data/`.
  //
  // A deferral here needs a reason that can be CHECKED later, not one that was
  // merely true when written.
];
