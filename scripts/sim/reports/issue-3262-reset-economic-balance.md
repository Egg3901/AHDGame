# 1991 reset economic balance evidence

Issue #3262. Target: `release/1.12-issue-resolution`.

## Audit and calibration plan

The audit compared the three player countries' opening fiscal books, sovereign
instruments, interest rates, plant entry prices, standard recipes, resources,
credit providers and NPP competitors. It then checked every materialized fiscal
country and every background-macro entity for currency-unit errors and broken
opening documents.

Confirmed defects were double inflation in construction, a large flat entry
fee, six default recipes with little payroll or input-price headroom, inaccurate
UK/JP debt anchors, disagreement between budget coupons and seeded bonds,
fiscal targets overwritten by authoritative US/UK political laws, double-counted
UK grants, stale nominal units in nine economy-only fiscal books, transition
currencies omitted from seed and runtime coverage, and miners assigned to barren
capital regions. The newer treasury bridge also retained stale source signatures,
opening law prices and a Japanese receipt override that no longer matched the
authored fiscal books. Ireland's runtime GDP conversion and a campaign baseline
still referenced the old denomination. Fresh bootstrap markers also failed to insert into an empty
configuration collection, preventing opt-in vehicle/media conversion.

The plan was to preserve fiscal receipts and debt scopes, calibrate real expense
models instead of adding artificial income, price construction from nominal
output once, retain the output baskets while reducing excessive default inputs,
seed funded competitors within actual market/deposit capacity, and add reset
acceptance checks that inspect values and accounting identities.

## Construction and operating evidence

Reproduce the portable component report:

```bash
npx tsx scripts/sim/resetEconomicBalance.ts
```

The production rules price one first facility per standard recipe, including the
entry fee, affordable country prime rate and neutral CEO. Operations use the
production input, payroll, price-realization, and positive plant-overhead rules.
No subsidy or policy credit is assumed. Full utilization and sales are assumed;
corporate/regional tax, debt funding, construction delay, clearing and subsequent
turn feedback are excluded. This measures operating viability, not a guarantee
of sales or cash payback. Ordinary construction keeps its existing 20% expansion
discount. Existing paid build orders retain their stored cost.

| Player country | Opening prime | Entry price / daily revenue | Standard operating margin | Worst stressed margin |
| -------------- | ------------: | --------------------------: | ------------------------: | --------------------: |
| US             |            4% |                1.45 to 1.51 |            13.8% to 31.2% |                 5.04% |
| UK             |          4.5% |                1.50 to 1.56 |            13.8% to 31.2% |                 5.04% |
| JP             |            3% |                1.35 to 1.41 |            13.8% to 31.2% |                 5.04% |

All 51 country/sector combinations have positive operating profit. The stress
case raises input prices and wages by 10% and lowers output prices by 10%
through the engine's actual price-realization rule. The manufacturing/vehicles
and media/entertainment reset identities reuse the tested operating recipes.

## Fiscal and currency evidence

The portable legacy fiscal builders produce the following annual native amounts.
The actual bootstrap separately calibrates the authoritative political-law book
and checks its persisted result after another real budget refresh. Negative
deficit percentages denote a surplus. The legacy UK builder omits its period
pension obligation, so its surplus must not be presented as the newer funded
treasury book.

| Country | Debt principal |     Receipts | Spending including coupons | Deficit / GDP |
| ------- | -------------: | -----------: | -------------------------: | ------------: |
| US      |     USD 3,665B | USD 939.214B |               USD 970.214B |          0.5% |
| UK      |   GBP 194.118B | GBP 229.306B |               GBP 209.256B |       -3.342% |
| JP      |       JPY 172T | JPY 123.714T |               JPY 126.064T |          0.5% |

The newer treasury books preserve period pension continuity and protected
regional grants. Their shared source-claim calibration also feeds current-law
boards, proposal pricing, enactment and department ownership, so later reforms
do not restore the discarded expense baseline. Receipts stay unchanged; the old
Japanese receipt override is removed. Source drift guards remain active.

| Treasury book |     Receipts | Spending including coupons | Deficit / GDP |
| ------------- | -----------: | -------------------------: | ------------: |
| US            | USD 939.214B |               USD 970.214B |          0.5% |
| UK            | GBP 229.306B |               GBP 232.306B |          0.5% |
| JP            | JPY 123.714T |               JPY 120.840T |       -0.611% |

US debt rounds FY1991 Treasury public debt securities including intragovernmental
holdings. UK uses end-March 1991 gross consolidated public-sector debt. Japan
uses end-FY1991 central-government general bonds. These are intentionally named
existing fiscal-book scopes, not a harmonized general-government debt dataset.
Sources: [US Treasury FD-1](https://www.fiscal.treasury.gov/files/reports-statements/treasury-bulletin/b16.pdf),
[Bank of England](https://www.bankofengland.co.uk/-/media/boe/files/quarterly-bulletin/1991/the-net-debt-of-the-public-sector-end-march-1991.pdf),
[Japan Ministry of Finance](https://www.mof.go.jp/english/policy/budget/budget/fy2025/01.pdf).

Inherited debt keeps its average coupon: 7.5%, 10.5%, and 5.8%, respectively.
Lower policy rates price new borrowing. Opening inherited instruments are quoted
at the present value of their coupons using the new policy/risk yield, preserving
principal and coupon service. Calibrated US/UK expense fractions persist in
current laws, all proposable option levels, and catalog-only fiscal read models.
Receipts, political level identities and non-fiscal policy effects are preserved.

IE, FR, IT, ES, SE, TR, GR, AT and FI now use observed 1991 native-money GDP.
Their fiscal amounts and regional totals are rebased coherently. The release
branch's shared 1991 WDI/IMF anchors supply GDP, FX, expenditure and available
gross-debt ratios for the eight Western countries. GR/AT/FI retain the 1979
program mix as scenario provenance while their aggregate expenditure and debt
use the 1991 observations. Sweden/Turkey retain authored debt ratios where the
IMF series has no 1991 value. Actual enacted-law expenses preserve the anchored
envelopes across a fiscal refresh. FX corrections use WDI annual native-money
observations, including restoration of old Turkish lira.
Sources: [WDI native GDP API example](https://api.worldbank.org/v2/country/IRL/indicator/NY.GDP.MKTP.CN?date=1991&format=json),
[WDI exchange-rate API example](https://api.worldbank.org/v2/country/FRA/indicator/PA.NUS.FCRF?date=1991&format=json),
[official euro conversions](https://ec.europa.eu/eurostat/cache/metadata/en/ert_bil_conv_esms.htm),
[Turkish denomination history](https://www3.tcmb.gov.tr/yillikrapor/2016/en/m-0-2.php).
Fiscal aggregates: [IMF expenditure series](https://www.imf.org/external/datamapper/api/v1/G_X_G01_GDP_PT),
[IMF gross-debt series](https://www.imf.org/external/datamapper/api/v1/GGXWDG_NGDP).

Ireland's gross debt is IR£28.355454256B, converted from the CSO's published
1991 general-government gross stock of EUR36.004B. The narrower national-debt
measure is not substituted. Its debt/GDP ratio is recalculated against the
restored WDI GDP rather than copied from a different national-accounts vintage.
Source: [CSO Statistical Yearbook, table 9.6](https://www.cso.ie/en/media/csoie/releasespublications/documents/statisticalyearbook/2013/c9publicfinance.pdf).

PL/HU/RO/BG/CS/YU currencies now seed and participate in monetary queries and
runtime updates. Germany retains the release scenario's explicit EUR-equivalent
accounting convention with consistent GDP and FX. RU retains the authored whole-Union GDP and an administered
opening quote. BR retains its explicitly stabilized game-BRL accounting unit;
it is not a literal 1991 cruzeiro observation. RO/BG/PL/CS opening fixings are
preserved rather than confused with annual-average quotes. Reunified Germany
has no separate DD bank or FX row. Background-macro entities use finite tagged
aggregate estimates, rather than fictitious standalone financial markets.

## Resource, credit and competitor acceptance

Fresh seed competitors fill every player market, including the converted
vehicle and entertainment identities. Grants consume unowned market headroom;
miners choose a supported region/recipe and use at most one quarter of its
resource ceiling. Existing abundant deposits are preserved. Each player country
must have at least two active bank charters with positive posted capital, cash
reserves and the correct national currency. Local competitor names are unique,
with country-specific brands such as Copperline, Kestrel Yard and Aobane.

`resetEconomicOpening.integration.test.ts` boots an empty isolated in-memory
world with both fresh reset identity flags, checks all opening documents,
refreshes player fiscal books, repairs deliberately removed retail/vehicle/
entertainment competitors without duplicates, and demonstrates detection of
non-finite FX and missing background data. No live data or live reset is used.

`checkEconomicOpening` is part of seed conformance. It checks currency coverage,
affordable rates, finite fiscal totals, debt/GDP and surplus identities,
instrument principal/coupons, player deficits, funded banking, all player markets,
resource headroom, market ownership, index-fund capital and expected macro
entities. Source GDP/FX and fiscal continuity tests independently test nominal
units rather than treating finite numbers as proof of correct denominations.

## Recorded deterministic qualification

After integration with the release branch, the complete fresh-reset acceptance
passed all four tests, including another runtime fiscal refresh and idempotent
repair of converted market identities. The portable 51-scenario report passed.
The post-integration fiscal-anchor/GDP/continuity batch passed 131 tests; the
final Irish debt adjustment passed its 28-test rerun. Affected bond, FX, regional
budget, UK forecast, operating-balance and grant regressions passed 87 tests.
Earlier focused suites also qualified construction, founding, extraction,
competitor spawning, law enactment, fiscal read models and monetary scope.
The follow-up treasury/current-law/metric qualification passed 114 tests across
29 files. The recalibrated NPC cadence replay passed all 15 tests, preserving
strategy choices and equivalent persistence while recording the intended
construction budget changes. Scoped strict TypeScript passed. ESLint and formatting passed across all changed
files; the architecture audit has zero blocking findings. Full release gates
are tracked by the PR's CI checks.

## Qualification limits

The component report and reset fixture establish opening balance and accounting
continuity. A source-pinned autonomous world run is separate qualification for
later market clearing, input shortages, NPC borrowing and policy drift. Its
status must be recorded separately from these deterministic results before reset
promotion. Player policy choices can change interest rates and fiscal balance.

A 96-turn sandbox qualification uses plant markets, full labour and v5
autonomy under the ordinary overnight start policy. The final source commit,
job ID and latest status are tracked in [PR #3279](https://github.com/Egg3901/AHDGame/pull/3279).
No autonomous-run results were available when this deterministic evidence was
recorded. The run uses the simulation bootstrap's default identities; the
separate acceptance fixture qualifies both opt-in vehicle/media conversions.
