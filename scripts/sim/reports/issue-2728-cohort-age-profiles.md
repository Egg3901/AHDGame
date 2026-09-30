# Issue 2728: France and Spain 1991 cohort stocks

## Root cause and scope

The two countries have no resolvable 1991 general census bundle. The stock seeder
previously required that whole bundle before reading its age dimension, so all
sixteen regional age/sex stocks were skipped. Two actual-seeder regressions
returned zero covered regions instead of eight per country before repair.

Cohort initialization now resolves an explicit age-only 1991 profile before using
its existing census fallback. Other dimensions are not inferred, and no 1979
census is relabeled as 1991. Other countries and eras retain the existing path.
Existing worlds and population totals are unchanged.

## Dated observations and proxy assumptions

Eurostat `demo_pjan`, sexT, unitNR, reference1 January 1991, revision
2026-09-25T23:00:00+0200, retrieved2026-10-01. Raw single ages 0-99, 100+ open-age
counts and zero unknown-age counts reconcile to each published national total.
Adult bands 18-29, 30-44, 45-64, 65+ are summed independently, then normalized over 18+.

| Country |      18-29 |      30-44 |      45-64 |       65+ | Adult total | Source population |
| ------- | ---------: | ---------: | ---------: | --------: | ----------: | ----------------: |
| FR      | 10,683,857 | 13,207,348 | 11,941,786 | 8,142,988 |  43,975,979 |        58,313,439 |
| ES      |  7,669,831 |  7,762,473 |  8,510,732 | 5,348,081 |  29,291,117 |        38,881,416 |

Primary observations: [France](https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/demo_pjan?geo=FR&time=1991&sex=T&unit=NR),
[Spain](https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/demo_pjan?geo=ES&time=1991&sex=T&unit=NR).
[Eurostat metadata](https://ec.europa.eu/eurostat/cache/metadata/en/demo_pop_esms.htm)
define1January population and open-age classes. Source counts and provenance are
pinned in `cohortAgeProfiles1991.ts`; reset needs no network access.

Each country's national adult age shape is an explicitly estimated proxy for its
eight existing aggregate regions. It is not an observed regional age distribution.
France's source-series population58,313,439 differs from the modeled metropolitan
opening population56,840,661. Spain's1January38,881,416 differs from its modeled
midyear anchor38,966,376. Only normalized age shares are used; neither source total
replaces the independently scoped population anchors from#2676.

Youth age weights and sex splits continue to use the existing synthesis model and
seeded median-age/birth-rate inputs, with existing neutral defaults when absent.
Those synthetic stocks are not published as observed single-age/sex census counts.
Other unauthored census dimensions remain a separate country-readiness limitation.

## Portable cohort qualification

`scripts/sim/issue2728-cohort-age-profiles.ts` uses actual region populations,
production age-profile resolution, `synthesizeAgeSexVector` and `advanceCohort`.
All sixteen regions qualify through 48 isolated turns at neutral fertility and
healthcare, zero net migration. Each turn verifies finite nonnegative cells and
population change equal to births minus deaths plus net migration. Opening
whole-person stocks reconcile within the existing101-person per-region cell bound.
This is an isolated demographic report, not a full-world balance acceptance.

| Region | Target population | Opening stock | Stock after48 turns |
| ------ | ----------------: | ------------: | ------------------: |
| FR_IDF |        10,557,646 |    10,557,651 |      10,557,744.020 |
| FR_NOR |         6,078,645 |     6,078,644 |       6,078,697.228 |
| FR_EST |         6,398,573 |     6,398,578 |       6,398,635.646 |
| FR_OUE |         9,171,289 |     9,171,295 |       9,171,375.136 |
| FR_SOU |         6,825,145 |     6,825,152 |       6,825,211.688 |
| FR_ARA |         6,718,502 |     6,718,503 |       6,718,562.387 |
| FR_MED |         6,185,288 |     6,185,286 |       6,185,340.134 |
| FR_CEN |         4,905,573 |     4,905,573 |       4,905,616.884 |
| ES_MAD |         4,949,783 |     4,949,786 |       4,951,067.348 |
| ES_CAT |         6,213,557 |     6,213,554 |       6,215,163.517 |
| ES_AND |         6,740,130 |     6,740,132 |       6,741,877.850 |
| ES_VAL |         4,739,154 |     4,739,145 |       4,740,372.972 |
| ES_PVB |         2,738,178 |     2,738,176 |       2,738,885.082 |
| ES_GAL |         2,948,807 |     2,948,806 |       2,949,569.966 |
| ES_NOR |         3,475,379 |     3,475,381 |       3,476,280.574 |
| ES_CEN |         7,161,388 |     7,161,394 |       7,163,248.865 |

## Native qualification

The updated native harness calls all six actual country region seeders, the actual
cohort seeder, the complete conformance evaluator and ten actual demographic phase
calls in a generated disposable sandbox database. It checks 45 initialized stocks,
no skipped regions, deterministic repeat seeding, exact six-country initial
population reconciliation, finite nonnegative cells and updated state populations
matching vector totals through the ten demographic phases. These are phase calls,
not ten complete world turns or a full bootstrap claim.

Commands:

```sh
npx tsx scripts/sim/issue2728-cohort-age-profiles.ts
NODE_ENV=test AHD_TEST_MONGODB_URI=<disposable-test-server-uri> npx tsx scripts/verify/issue2676-population-reconciliation.ts
```

Full bootstrap, election periods, economy integration and exact-release replay
remain open on#2159. This closes only the sixteen missing initial cohort stocks.

## Results

Seven focused cases passed, including both actual-seeder regressions that failed
before repair. Sixteen portable48-turn cases passed. Five native cases passed:
all45 regions initialized with zero skips,1,408,656,509 whole-person opening
stock against1,408,656,519 target population, within cell-rounding bounds. Repeat
seeding retained vectors, and all ten actual demographic phase calls processed
45 regions with reconciled finite stocks. The generated database was removed.
