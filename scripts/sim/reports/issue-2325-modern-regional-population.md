# Issue #2325: modern regional population reconciliation

Run `npx tsx scripts/sim/issue-2325-modern-regional-population.ts` to reproduce the table. The harness selects the actual `2027-default` country bundles, reads the actual 2027 national budget seed configs, checks the selected region ids and fiscal population sum, and verifies the prior region proportions change only by largest-remainder integer allocation.

| Country | Existing share source | Before regional sum | 2027 fiscal anchor |     After sum |
| ------- | --------------------- | ------------------: | -----------------: | ------------: |
| IE      | IE 2023 bundle        |           4,740,000 |          5,100,000 |     5,100,000 |
| CN      | CN 2027 bundle        |       1,238,000,000 |      1,412,000,000 | 1,412,000,000 |
| NG      | NG 2023 bundle        |         223,000,000 |        200,000,000 |   200,000,000 |
| FR      | existing FR bundle    |          53,300,000 |         67,000,000 |    67,000,000 |
| IT      | existing IT bundle    |          55,900,000 |         60,400,000 |    60,400,000 |
| ES      | existing ES bundle    |          37,000,000 |         47,000,000 |    47,000,000 |
| SE      | existing SE bundle    |           8,300,000 |         10,300,000 |    10,300,000 |
| GR      | existing GR bundle    |           9,500,000 |         10,700,000 |    10,700,000 |
| AT      | existing AT bundle    |           7,550,000 |          8,900,000 |     8,900,000 |
| FI      | existing FI bundle    |           4,770,000 |          5,500,000 |     5,500,000 |

The national figures above are existing game fiscal population anchors, not new demographic observations. The change adds an explicit 2027-only region selection for each country and allocates whole residents to those anchors using the existing shared largest-remainder rules. Region ids, metadata, and relative weights are preserved. Existing 2019 and authored 2023 bundle selection remains unchanged. These weights are transparent interim proxies; this change does not claim that each country has a new 2027 regional census series.

Official dated data checked for replacement and validation work:

- Eurostat's regional population dataset `demo_r_pjanaggr3` covers 1990-2025 at NUTS 3 and was updated 8 May 2026: [dataset](https://ec.europa.eu/eurostat/databrowser/view/demo_r_pjanaggr3/default/table?lang=en). It provides public regional observations for the eight European countries here, with NUTS boundary vintages requiring explicit mapping to the game regions.
- France publishes official 2023 regional population counts with reference date 1 January 2023 and limits in force 1 January 2025: [INSEE](https://www.insee.fr/fr/statistiques/8680653).
- China's National Bureau of Statistics publishes province counts from the 2020 census, reference time 1 November 2020: [NBS communiqué](https://www.stats.gov.cn/english/PressRelease/202105/t20210510_1817188.html).
- TurkStat publishes annual province and Statistical Region (SR) counts from ABPRS, including the 2023 reference year: [ABPRS 2023 results](https://veriportali.tuik.gov.tr/Bulten/Index?dil=2&p=Adrese-Dayali-Nufus-Kayit-Sistemi-Sonuclari-2023-53783) and [dataset metadata](https://veriportali.tuik.gov.tr/en/databrowser/tuik/TR%2CDF_ADNKS_T17%2C1.1).
- Nigeria's National Population Commission says the most recent census was in 2006; its planned 2023 census was postponed. Official projections remain census-based: [NPC census history](https://nationalpopulation.gov.ng/census-enumeration), [NPC publications](https://www.nationalpopulation.gov.ng/publications). No post-2006 state-level count was represented as observed data here.

The official sources are a source inventory, not the input to the current game anchors or proportional weights. In particular, the issue's requested fresh bootstrap and short worldsim probe have not been run against this revision. The earlier archived probe predates this code and is not evidence for this diff. The targeted Vitest passes 2 tests; the deterministic harness is the reproducible local reconciliation evidence. A current fresh-bootstrap/worldsim result remains outstanding before issue closure or merge.
