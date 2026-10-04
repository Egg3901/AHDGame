# January 1991 opening central-bank benchmarks

Issue #3034 item 3 found the first-turn central banks using modern defaults:
US 3, UK 3, JP 1, DE 3 and IE 3 percent. The new seed-only portable resolver
uses the policy benchmark in force on January 1, 1991. It deliberately does
not use annual means, year-end rates or the game's neutral monetary target.

| Country | Previous | Opening benchmark | Instrument                       |
| ------- | -------: | ----------------: | -------------------------------- |
| US      |        3 |                 7 | Intended federal funds target    |
| UK      |        3 |             13.88 | Official Bank Rate               |
| Japan   |        1 |                 6 | Official discount rate           |
| Germany |        3 |                 6 | Bundesbank discount rate         |
| Ireland |        3 |             11.25 | Central Bank short-term facility |

The game's `primeRate` field represents these central-bank policy benchmarks;
it is not a historical commercial-bank prime lending series. The different
instruments are explicit approximations of the same game control. Germany's
separate Lombard rate was 8.5 percent and is not substituted for discount.

Sources verified 2026-10-04:

- US: Federal Reserve released intended-rate history, official table page 24,
  December 18, 1990 target 7 percent. The next cut is January 9, 1991.
  https://www.federalreserve.gov/foia/files/20190829-changes-intended-federal-funds-rate.pdf
- UK: Bank of England rate history, October 8, 1990 value 13.88; the next
  change is February 13, 1991. The official series uses 13.88, not the
  commonly rounded commercial base rate of 14.
  https://www.bankofengland.co.uk/boeapps/database/Bank-Rate.asp
- Japan: Bank of Japan official rate CSV, August 30, 1990 value 6; the next
  change is July 1, 1991. The separate bills-related column is not used.
  https://www.boj.or.jp/en/statistics/boj/other/discount/cdab0100.csv
- Germany: Bundesbank published discount/Lombard history, November 2, 1990
  discount 6; the next change is February 1, 1991.
  https://www.bundesbank.de/resource/blob/651504/9dad568ed96af0fda517b17a3fe7f1cf/mL/s510ttdiscount-data.pdf
- Ireland: OECD 1991 country survey chronology, printed page 116, December
  21, 1990 short-term facility raised to 11.25 percent. This observation
  supersedes the October cut to 10.5.
  https://www.oecd.org/content/dam/oecd/en/publications/reports/1991/01/oecd-economic-surveys-ireland-1991_g1g1718f/eco_surveys-irl-1991-en.pdf

`updateCentralBanks` writes the corrected rate only with `$setOnInsert`.
Reapplication preserves a campaign's rate decisions, history, reserves and
forex revenue. The bank-detail bootstrap accepts the current game year and
uses the same benchmark if a missing bank is created in 1991. Its existing
world-state read is reused. The seed diagnostic checks the same authored
start-year value. Other years and countries keep their existing defaults.

Runtime neutral rates, NPC monetary reactions, historical cuts and shared
monetary authority remain independent mechanics. No clock-driven historical
rate path overrides subsequent player or NPC policy. Existing live worlds
are not backfilled or reset by this change.

Ninety cases pass across five suites, including four actual Mongo journeys.
Fresh 1991 initialization uses two commands and 927 reply bytes. Reapplication
preserves a subsequently chosen US rate, its history and forex revenue. Fresh
1953, 1979 and 2027 worlds preserve their prior seeder defaults. Twelve portable
resolver cases, the bootstrap regression and diagnostic expectations pass.
Scoped strict TypeScript, lint, formatting and blocking architecture checks pass.
