# Soviet and Nigerian 1991 GDP denomination correction

Issue #3034 item 4 also identifies Nigeria and the Soviet federal slot using
configuration factors inconsistent with their original-currency output.

Nigeria's six regional amounts previously summed to 241 trillion naira, while
the source observation is 590,059,736,200 circulating naira. The national anchor
is World Bank WDI `NY.GDP.MKTP.CN`, NGA 1991, accessed 2026-10-04:
https://api.worldbank.org/v2/country/NGA/indicator/NY.GDP.MKTP.CN?date=1991&format=json
The response reports a 2026-07-13 dataset update. The existing relative regional
output weights remain model estimates and are conserved by the existing portable
regional allocator. Population 88,992,220 and the 360/109 seat allocations stay
unchanged. The authored opening quote of 9.9 naira per accounting unit supplies
the normalization factor; the annual-average WDI exchange-rate observation is
9.90949166666666 and is not substituted for the opening game quote.

The Soviet opening has 24 regions under the RU slot. Its output remains the
existing original-ruble proxy, including 14 republics estimated from 1988
net-material-product shares and the Russian 1991 anchor. It is not an observed
USSR nominal GDP series. The stored output now uses the game's existing opening
SUR quote, 2.22, instead of the inherited 1.35 factor. SUR was not freely
convertible; this opening accounting valuation is not a historical market rate
claim. Russian regions retain exactly the same stored ruble amounts after
succession, and institutional config overrides preserve the normalization basis.

| Country             | Before, accounting billions | Corrected, accounting billions |
| ------------------- | --------------------------: | -----------------------------: |
| Nigeria             |                     154.240 |                         59.602 |
| Soviet federal slot |                   3,089.975 |                      1,031.023 |

These are opening-quote valuations of the stored native output, not published
annual USD GDP outturns. No financial balance, creditor contract or market quote
is rewritten. New resets get the corrected Nigerian source total; existing
stored Nigerian regions require a separately authorized reset or backfill.
No live world is reset by this change.

Qualification exercises actual authored regional catalogs, original-currency
normalization, preserved Nigerian population/seats and five Russian institutional
states. An isolated Mongo journey loads the active preset and actual regional
rows through `loadUsdGdpByCountry`, then removes the departing Soviet regions
and checks retained Russian output in the same unit. This models territorial
removal for the GDP consumer; it does not claim a new full dissolution journey.
Existing 1953 and other-era tests protect their independent denominations.

Forty-seven cases pass across seven suites, including eight new catalog cases
and one real Mongo consumer journey. The original six passing suites contribute
46 cases; the unavailable fixture in the first Mongo attempt is not counted.
The repaired fixture journey passes separately with two commands and 3,343
reply bytes despite 100 KB unused payload per stored region. Scoped strict
TypeScript, lint, formatting and blocking architecture checks also pass.
