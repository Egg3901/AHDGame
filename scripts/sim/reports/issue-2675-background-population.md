# Issue 2675: background population sampler and economic reconciliation

## Reproduction and repair

The actual background builder failed all five roster distribution cases before repair:
only five distinct populations, all below 400,000. The polynomial hash divided by
2^32 without mixing its high bits, so short country ids produced values near zero.
The corrected pure rules sampler hashes all UTF-16 code units with FNV-1a and an
explicit 32-bit avalanche, then divides the unsigned result by 2^32. It is repeatable
and maps to [0, 1). Trait salts remain independent inputs to the sampler.

## Explicit modeling assumptions

This fixes the existing coarse simulation model. It does not introduce historical
population observations. Population remains `round(350000 + u^2 * 95000000)`;
opening-year income remains `(900 + max(0, year - 1950) * 115) * (0.55 + v * 1.9)`.
GDP remains rounded population times this income divided by one million, with the
existing 100 game-unit minimum. Stability, fiscal capacity, trade exposure, resource
ranges, sector weights and planned-market leakage are unchanged formulas.

Every generated document retains `dataQuality.provenance = estimated-background`,
with no claim that empty completeness arrays establish historical accuracy. Map
inspection explicitly labels these values as coarse simulation estimates. In
particular, the corrected 1991 background total of 5,254,929,894 is a synthetic
aggregate across this roster, not a claim about the historical world population.
India and small sovereign countries still use the same coarse range. Authoring
national statistical populations is separate from repairing range normalization.

Existing worlds are not migrated by this change. A future reset rebuilds the whole
macro document. Existing replacement seeding computes population, GDP, sector capacity,
domestic demand and the held contribution together; changing population alone would
leave an inconsistent old economy. No full-country or authored 1953 seed changes.

## Deterministic comparison

Run `npx tsx scripts/sim/issue2675-background-population.ts` for the full JSON.
The baseline replays all old sampled fields exactly through the real sector builder
and macro kernel. The corrected path calls the real background builder. Counts are
sovereign background entries from each current preset manifest. Near floor means
below 400,000. All populations remain between 350,000 and 95,350,000.

| Preset       | Countries | Distinct populations | Near floor | Corrected range       | Corrected population sum | Annual GDP ratio |
| ------------ | --------: | -------------------- | ---------- | --------------------- | -----------------------: | ---------------: |
| 1979-default |       142 | 5 -> 142             | 142 -> 4   | 350,000 to 93,656,971 |            4,820,702,711 |          266.57x |
| 1991-default |       155 | 5 -> 155             | 155 -> 4   | 350,000 to 94,631,848 |            5,254,929,894 |          267.63x |
| 1999-default |       174 | 5 -> 174             | 174 -> 4   | 350,000 to 94,631,848 |            6,070,185,516 |          273.46x |
| 2019-default |       187 | 5 -> 187             | 187 -> 4   | 350,000 to 94,631,848 |            6,304,351,592 |          265.27x |
| 2027-default |       187 | 5 -> 187             | 187 -> 4   | 350,000 to 94,631,848 |            6,304,351,592 |          265.43x |

The 1991 old population sum was 54,255,378, a 96.86x increase after correction.
Annual aggregate GDP rises from 167,534 to 44,837,524 game units, a 267.63x increase.
Income, stability and trade exposure were also suppressed by the old sampler;
this is why economic effects cannot be estimated from the population ratio alone.
Before repair nearly all commodity contributions rounded to zero. The real kernel
produces these aggregate per-turn shared-market units after repair:

| Commodity              | Old supply | Corrected supply | Old demand | Corrected demand |
| ---------------------- | ---------: | ---------------: | ---------: | ---------------: |
| steel                  |       0.00 |            28.93 |       0.00 |            15.40 |
| electronics            |       0.00 |             0.00 |       0.00 |            36.14 |
| energy                 |       0.00 |           250.57 |       0.02 |           646.87 |
| chemicals              |       0.00 |             0.00 |       0.00 |            23.25 |
| pharmaceuticals        |       0.00 |             0.00 |       0.00 |             2.52 |
| fertilizers            |       0.00 |             0.00 |       0.00 |            60.01 |
| food                   |       0.00 |           144.57 |       0.00 |            85.09 |
| building_materials     |       0.00 |            28.93 |       0.00 |            23.66 |
| construction_services  |       0.00 |             3.64 |       0.00 |             0.50 |
| healthcare_services    |       0.00 |             0.00 |       0.00 |             1.53 |
| real_estate_services   |       0.00 |             0.00 |       0.00 |             4.13 |
| software               |       0.00 |             0.00 |       0.00 |            14.76 |
| financial_services     |       0.00 |             5.80 |       0.00 |             3.40 |
| advertising            |       0.00 |             0.00 |       0.00 |            40.82 |
| vehicles               |       0.00 |             0.00 |       0.00 |             1.16 |
| retail                 |       0.00 |           173.49 |       0.00 |             0.00 |
| freight                |       0.00 |             3.47 |       0.00 |             7.26 |
| consulting_services    |       0.00 |             1.07 |       0.00 |             1.06 |
| iron                   |       0.00 |            77.04 |       0.00 |            53.70 |
| coal                   |       0.00 |            46.25 |       0.00 |            51.48 |
| oil                    |       0.00 |            40.45 |       0.00 |            60.77 |
| rare_earth             |       0.00 |             0.13 |       0.00 |             0.24 |
| timber                 |       0.00 |            11.61 |       0.00 |            20.01 |
| natural_gas            |       0.00 |           222.02 |       0.00 |           465.60 |
| ordnance               |       0.00 |             0.00 |       0.00 |             0.21 |
| plastics               |       0.00 |             0.00 |       0.00 |            15.05 |
| network_services       |       0.00 |             0.00 |       0.00 |             5.67 |
| entertainment_services |       0.00 |             0.00 |       0.00 |             5.05 |

## Qualification and limits

- 47 focused tests passed across background, macro-country and Yugoslavia exposure suites.
- Distribution regressions cover actual 1979, 1991, 1999, 2019 and 2027 rosters.
- 676 two-letter and 676 long ids exercise all six trait salts, with every decile
  populated, bounded values and deterministic repeats.
- Every 1991 profile's stored sectors match its GDP input and held contribution
  matches the actual kernel; all contribution values are finite and nonnegative.
- The comparison runs five presets and three output scenarios through 48 turns
  using actual six-turn scheduling and the kernel. Half output lowers or preserves
  supply; 1.25x output raises or preserves supply; neither changes demand. Held
  contributions remain consistent between refreshes.

This is a portable seed/kernel qualification, without database or world commodity
price clearing. It does not certify long-run world prices, player-country finance,
or global historical calibration. The large correction invalidates economic
qualification that depended on the collapsed background seed. The previously
pinned overnight run retains its original source and cannot qualify this repair;
release-wide balance acceptance remains under #2159's existing worldsim gates.
