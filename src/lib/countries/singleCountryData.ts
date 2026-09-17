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
export const CONVERTED: readonly string[] = ["JP"];

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

  // ---- Client surfaces. Bucket E: these RENDER the country, they do not own it. ----
  {
    file: "src/app/country/[code]/legislature/JPDietPage.tsx",
    country: "JP",
    why: "Client component. It renders the Diet from folder data; moving a page into a lib folder would put a React tree behind the server-only barrel.",
  },
  {
    file: "src/app/country/[code]/legislature/JPCabinetProposeBillModal.tsx",
    country: "JP",
    why: "Client component, same reasoning as JPDietPage.",
  },
  {
    file: "src/app/country/[code]/legislature/useJPDietPageState.ts",
    country: "JP",
    why: "Client hook for JPDietPage. Belongs beside the component it serves.",
  },
  {
    file: "src/components/JapanMapPaths.tsx",
    country: "JP",
    why: "SVG path data for a client map component, beside the other country map components.",
  },

  // ---- Tooling. Scripts ABOUT a country are not that country's data. ----
  {
    file: "scripts/countries/verify-jp-runtime.ts",
    country: "JP",
    why: "The runtime harness for Japan's folder. A test of the data, not the data.",
  },
  {
    file: "scripts/seed/seed-jp.ts",
    country: "JP",
    why: "Seed runner. It invokes the folder's seed step and holds no facts.",
  },
  {
    file: "scripts/migrations/backfill-jp-sangiin-seat-ids.ts",
    country: "JP",
    why: "A one-off migration against live data. Migrations are dated records of a change and stay in scripts/migrations.",
  },
  {
    file: "scripts/migrations/fix-jp-sector-market-sizes.ts",
    country: "JP",
    why: "One-off migration, same reasoning.",
  },
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
