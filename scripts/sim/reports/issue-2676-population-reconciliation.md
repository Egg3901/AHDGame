# Issue 2676: dated 1991 population reconciliation

## National sources and geographic scope

Source assumptions live in `src/lib/seeds/reference/populationTotals1991.ts` and are
pinned at retrieval on 2026-09-30. They are opening-year proxies, with deliberately
explicit reference dates rather than a claim that all observations refer to the
same day. No source fetch occurs during seeding or turn processing.

| Country | Old national input | Old regional sum | Reconciled national and regional total | Reference date |
| ------- | -----------------: | ---------------: | -------------------------------------: | -------------- |
| CN      |      1,158,000,000 |    1,118,840,000 |                          1,158,230,000 | 1991-12-31     |
| NG      |         95,000,000 |       88,992,200 |                             88,992,220 | 1991 census    |
| FR      |         57,000,000 |       53,300,000 |                             56,840,661 | 1991-01-01     |
| ES      |         38,900,000 |       37,000,000 |                             38,966,376 | 1991 midyear   |
| SE      |          8,600,000 |        8,300,000 |                              8,617,375 | 1991 midyear   |
| TR      |         57,300,000 |       43,500,000 |                             57,009,887 | 1991 midyear   |

- CN: [NBS 1991 statistical communique](https://www.stats.gov.cn/sj/tjgb/ndtjgb/qgndtjgb/202302/t20230206_1901935.html), population section: 115823 ten-thousand people at year end. The source covers mainland provinces, autonomous regions and municipalities. Hong Kong, Macao and Taiwan are excluded from this model's CN total.
- NG: [NBS Annual Abstract 2011](https://nigerianstat.gov.ng/pdfuploads/Annual_Abstract_of_Statistics_2011.pdf), Table12, printed page18, PDF page19: NPC census total88,992,220, including FCT Abuja. This retains the existing census-based population choice, rather than substituting the different WDI midyear estimate99,720,162. Six zones remain gameplay aggregates.
- FR: [INSEE series000067670](https://www.insee.fr/en/statistiques/serie/000067670):56,840,661 on1991-01-01. Scope is metropolitan France, including Corsica. Overseas departments and territories are excluded; the eight existing region shares represent this metropolitan aggregate.
- ES, SE and TR: World Bank WDI source2 `SP.POP.TOTL`, data revision2026-07-13, reference year1991. The [indicator metadata](https://databank.worldbank.org/metadataglossary/world-development-indicators/series/SP.POP.TOTL) defines annual midyear resident-population estimates. Pinned API observations: [Spain](https://api.worldbank.org/v2/country/ESP/indicator/SP.POP.TOTL?date=1991&format=json), [Sweden](https://api.worldbank.org/v2/country/SWE/indicator/SP.POP.TOTL?date=1991&format=json), [Turkey](https://api.worldbank.org/v2/country/TUR/indicator/SP.POP.TOTL?date=1991&format=json). Spain's islands and small territories are absorbed into the existing aggregate region model; Sweden's full national total is allocated across its eight aggregates; Turkey's total excludes Northern Cyprus. WDI lists UN and national statistical sources; these estimates are not relabeled as census counts. Attribution: World Bank, CC BY4.0.

## Regional assumptions

National totals have dated sources. Regional counts are explicitly **estimated
allocations** under the existing game geography. CN retains approximate1990-era
seven-region shares; NG retains its six-zone model shares. FR, ES, SE and TR retain
older eight-region shares as an explicit carry-forward assumption. No claim is
made that these shares are observed1991 provincial counts. New1991 bundles are
registered in both geography and actual seeders, so population does not silently
resolve to a1979 or modern bundle.

The pure `allocatePopulationTotal` rule uses largest remainder rounding with id
ordering for ties. Every region differs from its ideal normalized share by less
than one person, inputs are unchanged, and integer totals reconcile exactly.
GDP, chamber seats and region identities retain their existing authored inputs.
The broader era calibration gaps remain under their existing tracker gates;
this change qualifies population reconciliation only.

## Population-sensitive systems

- National budget configs use the same anchors as regions. Policy cost contexts
  therefore receive the reconciled population and national GDP per capita.
- CN and NG spending-cost scale anchors also use the corrected low-era population.
  The economy generator applies this verified correction after reading the
  immutable migration snapshot. Historical snapshots are preserved.
- Relative regional population weights are preserved within one-person rounding.
  Absolute population-based demand, services and voter pools receive corrected
  counts when built from newly seeded states. GDP-based sector weights and
  unowned revenue formulas are unchanged.
- The portable comparison calls the actual national config selector and per-capita
  policy cost path. CN/NG retain their existing low-era cost scales0.02/0.04;
  the other four have scale1. National GDP per capita derives from corrected
  population, with no separate stale divisor.
- Actual cohort seeding consumes the corrected population for all29 regions with
  available census profiles. Rounded age stocks reconcile within the mathematical
  half-person-per-cell rounding bound. Sixteen FR/ES regions lack resolvable1991
  census profiles before and after this repair and remain explicitly skipped.
  This is a separate demographic coverage defect, not certified healthy data.

## Verification

- Six country reconciliation cases failed before repair and passed afterward.
  -87 focused allocation, population, budget, cost-anchor, diagnostic and campaign tests passed.
- The native proof calls all six real region seeders in a generated disposable
  test database, writes45 regions and verifies deterministic repeat seeding.
- The actual complete conformance evaluator reports six passing population-sum
  checks, each with exact equality to its national input. No tolerance changes.
- Actual cohort seeding and stored stocks verify the downstream coverage above.
- The portable comparison covers every region's previous and corrected population,
  share drift, national GDP per capita and per-person policy cost.

Commands:

```sh
npx tsx scripts/sim/issue2676-population-reconciliation.ts
NODE_ENV=test AHD_TEST_MONGODB_URI=<disposable-test-server-uri> npx tsx scripts/verify/issue2676-population-reconciliation.ts
```

The native harness generates its own database name and drops only that database
in its cleanup block. This is scoped fresh-seed conformance proof, not a hosted
reset, a full bootstrap or whole-world balance acceptance. Existing worlds are
unchanged. Later presets with explicitly authored overrides retain those values;
later budgets that intentionally inherit1991 also inherit its corrected anchor,
with their existing source-era provenance. The final release bootstrap and
worldsim gates under#2159 remain open.

## Campaign income calibration

The complete CI derivation test exposed one stale dependent baseline: CN1991
GDP per capita was1,931 under the old regional population total. With unchanged
regional GDP and corrected population, its weighted mean is1,865. The derived
campaign baseline and its absolute pin now use1,865, preserving the neutral
scalar for an average region. Other country/era cells are unchanged; the existing
all-cell derivation and neutral-scalar regressions verify those dependencies.
This is a denominator reconciliation, with no GDP, exchange-rate or scalar-rule
tuning. Full-world balance and release replay remain open on#2159.
