# Ticket #1162 — exporter demand gap: balance impact

**Branch:** `fix/ticket-1162`
**Measured against:** live world, turn 319, year 1958, `marketSystemMode: "plants"`
**Date:** 2026-08-22

## Summary

`reachableDemandGap` returned zero for 301 of 310 net-exporter (country, commodity)
books, not because those markets were full but because the quantity cancels
algebraically. This change adds the missing term. On the live world it takes
zero-room books from 304 of 672 down to 12 of 672, and gives a US manufacturing
corporation 333,174 units/day of visible room where it previously saw none.

## Why there is no world-sim run in this report

**A headless world sim cannot observe this change, so one was not run.** This is a
deliberate call, not a gap.

`reachableDemandGap` and its wrapper `sectorDemandGapUnits` are read in exactly two
places, both read-only API paths that serve the founding and build UI:

- `src/app/api/corporations/[id]/expand-suggestions/route.ts` — the "Room for N" column
- `src/lib/corporations/queries/sectorDetail.ts` — the sector page's buyers'-room figure

No turn-engine code reads either. (`src/lib/turn/corporation/index.ts` matches a grep
only because a comment cites `sectorDemandGapUnits` by name when explaining unrelated
placement-ratio reasoning.) NPP autonomous founding gates on `headroomUnits` read from
the `unownedSectors` pool via `unownedHeadroomUnitsOf`
(`src/lib/turn/nppCorporationBehavior.ts:1621`), which this change does not touch.

`scripts/sim/runWorld.ts` runs with zero human players and every NPP autonomous. With
no code path from this change to any engine decision, the sandbox world would be
identical with and without the branch. A run would report "no difference detected",
which is true and also worthless: it would be evidence about the instrument, not about
the change.

What the change actually alters is how much room the founding UI **shows a human
player**. The behavioural consequence — players building where they previously believed
they could not — is real but is not something an NPP-only sim can produce.

The engine is nonetheless exercised: `buildReachableBooks` runs every turn inside
`commodityPriceTurn`, and its 26 tests plus the 96 trade-module tests pass.

## Root cause

`clearing.ts:24-31` sets each exporter's IPF row target to its surplus:

```
surplus[c] = supply[c] - demand[c]
```

`clearing.ts:84-90` scales that row to exactly `rowLimit[e] = surplus[e]` whenever
surplus binds, so `exports = supply - domesticDemand`. Substituting into the old gap:

```
gap = max(0, domesticDemand + exports - supply)
    = max(0, D + (S - D) - S)
    = 0
```

Identically zero for every net exporter, regardless of demand. This is the same
cancellation ticket #1077 identified and fixed for net importers (where `imports` was
pinned to `D - S`); the exporter side was left standing.

### Evidence on live data

| trade posture | (country, commodity) pairs | reported zero room |
| ------------- | -------------------------: | -----------------: |
| net exporter  |                        310 |    **301 (97.1%)** |
| net importer  |                        308 |           0 (0.0%) |
| no trade      |                         54 |                  3 |

Raw books, showing the cancellation to the unit:

```
US chemicals   S 1,168,192  D  816,964  X 351,228  ->  816,964 + 351,228 = 1,168,192 = S  -> 0
US coal        S 1,110,880  D  117,703  X 993,177  ->  117,703 + 993,177 = 1,110,880 = S  -> 0
UK chemicals   S   429,911  D    9,948  X 419,962  ->    9,948 + 419,962 =   429,910 ~ S  -> 0
FR chemicals   S   395,383  D 2,277,941 X       0  ->  net importer                       -> 1,882,558
```

This is why the US, UK, DE, RU, IE, SE, NG, AT and FI (exporters) read 18-20 of 28
commodities dead while FR, IT, CN and JP (importers) read 2-3. Support ticket #1162 was
filed by a US manufacturing corporation, which sat on the wrong side of it.

## The fix

An exporter's room for new capacity is the unserved foreign deficit it would plausibly
win:

```
unmet(i)         = max(0, -uncleared[i])
w(home -> i)     = affinity(commodity, home, i) * supply(home)
share(home -> i) = w(home -> i) / SUM over e of w(e -> i)

unmetForeignDemand(home) = SUM over i != home of unmet(i) * share(home -> i)
reachableDemandGap       = max(0, domesticDemand + exports - supply) + unmetForeignDemand
```

`uncleared` was already computed by `buildPerCountry` and simply never carried into the
book. Shares are normalised per importer, so they sum to 1 and the world never sees more
room than there is unserved demand. Affinity is already 0 for embargoed and
iron-curtained lanes, so those contribute nothing.

### Weightings considered and rejected

**Raw unweighted pool.** Measured: zero-room pairs 304 -> **0 of 672**, and the signal
goes country-blind — US, UK, DE and Greece all quote an identical 6,206,490 units for
manufacturing. That destroys exactly what ticket #1077 built per-country books to
provide. Rejected.

**Supply share only** (affinity flat, an upper bound on what shipped): zero-room 304 ->
3, US manufacturing 1,335,282, Greece 22,093. Differentiated, but blind to embargoes and
the iron curtain, so a curtained exporter reads room it cannot reach. Rejected.

**Affinity only:** normalises out country size, so a small well-connected economy quotes
nearly the same room as a large producer. Rejected.

## Measured impact of the shipped formula

Computed against the live world through the real `buildTradeAffinity` prior.

**Commodity books: 672 pairs, zero room 304 -> 12.** Twelve markets remain genuinely
full, which is the point: the fix removes an algebraic artefact, it does not declare
every market open.

Sector demand gap, units/day, current -> shipped:

| sector              | starter | US                     | UK             | DE                 | FR                       | JP                     | GR                | NG               | RU                 |
| ------------------- | ------: | ---------------------- | -------------- | ------------------ | ------------------------ | ---------------------- | ----------------- | ---------------- | ------------------ |
| financial           |       6 | 0 -> 22,526            | 0 -> 4,677     | 0 -> 5,718         | 52,812 -> 90,991         | 0 -> 9,367             | 0 -> 2,634        | 0 -> 2,597       | 7,818 -> 32,441    |
| manufacturing       |      25 | 0 -> 333,174           | 0 -> 38,005    | 0 -> 84,762        | 1,027,498 -> 1,126,094   | 0 -> 85,785            | 0 -> 5,513        | 0 -> 48,790      | 0 -> 64,838        |
| chemical_industries |      60 | 0 -> 847,591           | 0 -> 523,974   | 0 -> 103,456       | 2,006,807 -> 2,290,372   | 738,706 -> 896,800     | 0 -> 34,864       | 0 -> 68,140      | 0 -> **0**         |
| technology          |      25 | 0 -> 207,586           | 0 -> 136,213   | 0 -> 130,283       | 3,904,539 -> 3,936,704   | 156,382 -> 332,259     | 0 -> 157,758      | 0 -> 111,832     | 0 -> 6,560         |
| energy              |     250 | 0 -> 24,411,373        | 0 -> 571,999   | 0 -> 1,449,884     | 28,246,108 -> 29,238,660 | 7,533,648 -> 9,203,736 | 97,119 -> 198,230 | 0 -> 495,510     | 0 -> 1,504,952     |
| agriculture         |      60 | 0 -> 11,324,629        | 0 -> 1,400,404 | 0 -> 1,221,491     | 14,312,618 -> 16,223,703 | 1,866,698 -> 4,144,298 | 0 -> 613,587      | 0 -> 1,169,297   | 0 -> **0**         |
| defense             |       8 | 0 -> 850,073           | 0 -> 122,528   | 0 -> 86,855        | 1,083,584 -> 1,759,748   | 0 -> 97,716            | 0 -> 37,854       | 0 -> 59,774      | 0 -> **0**         |
| extraction          |     250 | 0 -> 3,778,068         | 0 -> 28,016    | 0 -> 36,182        | 4,463,815 -> 4,496,269   | 581,729 -> 1,245,068   | 19,617 -> 19,617  | 0 -> 22,231      | 0 -> **0**         |
| retail              |      80 | 1,111,294 -> 1,111,294 | 0 -> 0         | 222,142 -> 222,142 | 0 -> 0                   | 672,706 -> 672,706     | 0 -> 0            | 77,050 -> 77,050 | 369,428 -> 597,642 |

Three checks that the weighting is behaving:

1. **Scale is preserved.** US manufacturing 333,174 against Greece 5,513 — a 60x spread
   tracking supply mass, not a flat pool.
2. **The iron curtain holds.** RU stays at exactly 0 for chemicals, agriculture, defense
   and extraction: a Warsaw Pact exporter gets no share of Western unserved demand,
   because `affinityFor` returns 0 across the curtain.
3. **Genuinely served markets stay served.** Retail is unchanged in every country. There
   is no unserved foreign deficit in the retail output mix, so the new term is zero and
   the old answer stands.

## Player-facing effect

The reporting corporation is Dangote (`#557`), US manufacturing, held by Deprince. Before:
all 51 US states quoted "Room for 0" for manufacturing. After: 333,174 units/day of
in-country room against a 25-unit starter plant.

Founding was never actually blocked — `expandSector` gates only on capital, command
economy, and already-present — so this changes what the player is told, not what the
server permits.

## Risk

- **Deploy turn.** Live books carry no `unmetForeignDemand` until the next turn runs.
  `reachableDemandGap` heals a missing field to 0, so the world keeps today's behaviour
  for one turn rather than throwing. Asserted by test.
- **Direction of error.** The change can only increase a reported gap, never decrease
  one. The worst case is over-optimism about foreign room, mitigated by the affinity and
  supply weighting and by shares summing to 1.
- **A country producing none of a commodity** gets no export share and sees only its
  domestic gap. Correct for a would-be exporter; country-level supply is almost always
  non-zero, so it does not affect greenfield state builds.
- **Not covered:** whether increased player building eventually depresses commodity
  prices. That needs players, not an NPP sim. Worth watching in the live economy over
  the first few weeks after deploy.

## Reproduction

The measurements above come from `scripts/debug/t1162-impact.ts` (read-only, live DB),
which rebuilds the affinity prior exactly as `commodityPriceTurn.ts:1171-1202` does. That
script is a working aid and is not part of the shipped branch.
