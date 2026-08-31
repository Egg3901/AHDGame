# Front supply: air arm, depth, Logistics commands and home soil

Date: 2026-08-30. Script: `scripts/sim/frontSupply2026-08-30.ts`, run against the live
database at turn 503. "Before" is the same script run on `development` (45f354373);
"after" is this branch.

## The problem

The live German front (`war_us_dd_415`). The Warsaw Pact holds 85.5% of the map with 84%
air superiority over the front, and its war room reads SUPPLY: CUT OFF. Measured with
the real engine and the real naval and air support the resolver applies:

|                             | Pact (7 nations, 75 formations) | NATO (8 nations, 65 formations) |
| --------------------------- | ------------------------------- | ------------------------------- |
| demand / turn               | 2,107                           | 1,414                           |
| of which air, naval, rocket | 1,141                           | 972                             |
| throughput                  | 463                             | 754                             |
| supply level                | **22 CUT OFF**                  | 53 SHORTAGE                     |
| attrition multiplier        | 2.25x                           | 1.75x                           |

Three things put it there, none of which the commander could fix:

1. **Demand is treasury upkeep / 12, whatever the formation is.** A Fighter Wing costs
   250 a turn to an Infantry Division's 70, so the model billed a wing as three and a
   half divisions of trucked tonnage at a land front. Every wing and missile brigade
   posted at the theater is always in depth (engage 0.10) and paid in full.
2. **Depth was billed like the line.** Only 7 of the Pact's formations fit the 4,000
   frontage; the other 52 added full demand and, past parity with the teeth, no
   throughput (the tail bonus is `34 x min(depth, teeth)`).
3. **Every throughput term is a flat constant sized for an eleven-formation front**
   (infra 70, doctrine 26, a general up to 52, a Logistics command 20). A Soviet
   Logistics command over the region was worth +6 throughput here; reaching SUPPLIED
   needed ~1,160.

There is no host or defender supply term anywhere in the model; both sides seed at 60
and the only asymmetry is the displacement penalty, which currently runs against the
Pact (overextended, 55) and NATO (compressed, 46).

## The change (`FRONT_SUPPLY`, config.ts)

|     | Rule                                                                                                                                                                                                                                    | Value                        |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| A   | Air, naval, rocket and space formations draw this share of upkeep from the land-front pool. Ground and marine pay in full.                                                                                                              | `offFrontDemand` 0.25        |
| B   | A Logistics command covering the region delivers this share of its own contingent's front demand, times effectiveness, instead of a flat 20. Strongest overlapping command wins; aggregated unit-weighted across contingents as before. | `logisticsCommandShare` 0.25 |
| C   | Formations the engagement plan leaves in depth draw this share. Keyed on `plan.inContact`, never the player's label.                                                                                                                    | `depthDemand` 0.6            |
| E   | The side holding the conflict's host country (the nation declared on) multiplies its throughput, before interdiction.                                                                                                                   | `hostSideThroughput` 1.25    |

Each was measured alone, in every pair, and together, at defender levels x1.10 / x1.25 /
x1.50, on the RU+DD attacker roster (`scripts/debug/ussr-supply-fix-matrix.ts`; the
resolver's own roster below is the full seven-nation side, hence the higher demand):

| Fix                             | Pact            | NATO             |
| ------------------------------- | --------------- | ---------------- |
| none                            | 22 CUT OFF      | 53 SHORTAGE      |
| A alone                         | 35 SHORTAGE     | 100 SUPPLIED     |
| B alone (with a Soviet command) | 32 SHORTAGE     | 57 STRAINED      |
| C alone                         | 34 SHORTAGE     | 79 STRAINED      |
| A+B+C                           | 60 STRAINED     | 100 SUPPLIED     |
| A+B+C, host x1.10               | 66 STRAINED     | 100 SUPPLIED     |
| **A+B+C, host x1.25**           | **75 STRAINED** | **100 SUPPLIED** |
| A+B+C, host x1.50               | 90 SUPPLIED     | 100 SUPPLIED     |

x1.10 is indistinguishable from none. x1.50 lets a defender stack a front without limit
and hands +50% to the side already holding 85% of the map. x1.25 keeps the cost of
stacking real: the full Pact never reaches SUPPLIED at one front.

## Result: opening supply, the resolver's rosters

|                                                        | Before                                | After                                    |
| ------------------------------------------------------ | ------------------------------------- | ---------------------------------------- |
| Pact attacking, as deployed                            | 22 CUT OFF (2,107 / 463, attr 2.25x)  | **64 STRAINED** (897 / 577, attr 1.58x)  |
| Pact attacking, with a Soviet Logistics command at 0.7 | 22 CUT OFF (2,107 / 469)              | **73 STRAINED** (897 / 656, attr 1.43x)  |
| NATO attacking                                         | 53 SHORTAGE (1,414 / 754, attr 1.75x) | **100 SUPPLIED** (516 / 765, attr 1.00x) |
| Odds, Pact attacks / NATO attacks                      | 63% / 40%                             | 63% / 39%                                |

Odds are unchanged to the point: `effMult` is `0.55 + 0.45 x level / 100`, deliberately
gentle. What moves is attrition, which is `1 + (1 - level / 100) x 1.6`.

A Logistics command is now worth 9 supply points to the Pact (+79 throughput) against
the 1 point (+6) it was worth before. It still needs commanders and capacity to be
effective, and one command per flag covers only its own formations.

## Result: the war run forward

One side presses every turn with trained refill, real per-turn flows, from the live
control of 85.55. Side B wins at 100, side A at 0, cap 400 turns.

|                                               | Before                                                               | After                                        |
| --------------------------------------------- | -------------------------------------------------------------------- | -------------------------------------------- |
| Pact presses, as deployed                     | B takes the map on turn 39; dead 209k / 889k                         | B takes the map on turn 12; dead 68k / 268k  |
| Pact presses, with a Soviet Logistics command | turn 39; 209k / 890k                                                 | turn 12; 67k / 271k                          |
| NATO presses, as deployed                     | **no resolution after 400 turns**, control 79.65; dead 8.80M / 2.71M | B takes the map on turn 28; dead 650k / 175k |
| NATO presses, with a Soviet Logistics command | no resolution, control 79.33; 8.79M / 2.71M                          | B takes the map on turn 15; 363k / 80k       |

The before column is the state the live game is in. A side holding 85% of the map with a
five-to-one manpower edge takes 39 turns to close the last 15 points because it fights
every battle at 2.25x attrition; and when NATO presses instead, the war never resolves:
400 turns and eleven and a half million dead, both sides starved, neither able to break
the other. That is the meat grinder the supply multipliers were producing on both sides
of the line at once.

After: the side that is winning wins, in a dozen turns, at a third of the cost. NATO
pressing into a supplied defence now loses ground and the war ends inside 30 turns
rather than never. Nothing here changes who the front favours; the odds are the same to
the point. It changes whether a war at this scale can end.

## Not changed

- `FRONT_CAPACITY_BASE` and the tail bonus. The frontage cap still decides who stands
  in the line and still punishes stacking: 75 Pact formations at one front read
  STRAINED, not SUPPLIED.
- `countryScale` still multiplies demand (RU 2.4, US 2.6). A big power's formations are
  still costlier to keep at a front than a small one's.
- The displacement penalties (`derivedSupply`). The host bonus is multiplicative on top
  of them, so a defender pushed into a pocket still loses supply.
- The forecast route omits the naval and air layer entirely (it calls `battleForecast`
  without support), so the war room shows the Pact at 28 where the battle fights at 22.
  Separate bug, separate fix.
