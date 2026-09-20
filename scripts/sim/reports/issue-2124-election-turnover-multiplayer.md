# Issue #2124: election turnover across multiplayer systems

Date: 2026-09-20  
Source revision: `3741c2578c0d5ba5f42adb41ba94696194c00393` (`origin/development`)  
Scope: anonymized production aggregates and existing sandbox evidence

## Conclusion

The zero-turnover evidence on [#2124](https://github.com/Egg3901/AHDGame/issues/2124) is real for the cited autonomous sandbox, but it does not generalize to multiplayer.

In the production multiplayer world, party control changes in the high-volume US and UK races, including House, Senate, governor, state Senate, regional council, and Commons elections. The remaining cross-system question is why some autonomous and regime-specific election families show no control turnover, why the `audit-allflags-1953-r3` House run produced zero leading-party flips, and whether different seat converters respond correctly to controlled vote swings. Presidential control is a separate concern: all six resolved live presidential cycles were won by party `1`, including later elections with large all-player fields. Presidential resolution uses a separate Electoral College and executive-seating stack, so it should have its own reset blocker.

## Cross-system multiplayer evidence

A bounded read-only production query examined 3,588 resolved non-presidential elections across 37 election types; 3,547 had a usable stored result. Comparisons used the same country, election type, region/constituency, and chamber class across consecutive cycles. A control flip was counted only when both results had one unique leading party. The query emitted no player names or account data.

The largest player-participating families show real turnover:

| Election family   | Player cycles | Consecutive player cycles | Seat/winner changes |              Unique control flips |
| ----------------- | ------------: | ------------------------: | ------------------: | --------------------------------: |
| US/other governor |           129 |                        72 |                  13 |                          13 of 72 |
| US House          |           143 |                       104 |                  86 | 25 of 81 uniquely led comparisons |
| US/other senate   |           152 |                        84 |                  25 |                          25 of 84 |
| State senate      |            11 |                         3 |                   3 |                            1 of 3 |
| Regional council  |            18 |                         6 |                   6 |   1 of 5 uniquely led comparisons |
| UK Commons        |            56 |                        42 |                  40 | 17 of 40 uniquely led comparisons |

This rejects a blanket claim that multiplayer seats rarely or never change hands. It does not establish that every election family is healthy. Several systems recorded no leading-party turnover in the retained window, including Supreme Soviet deputy families, the PRC NPC/people's-congress families, and several national chambers. Some may be intentionally regime-constrained, while others may expose the same calibration problem as the autonomous House run. They require system-specific expectations rather than being silently combined with competitive elections.

## House-specific evidence

A bounded read-only production query joined resolved US House elections to their candidate rows and stored `seatsEstimate`. It aggregated seats by party and emitted no player names, character IDs, account IDs, or vote totals.

- 541 resolved House elections were retained; 535 had usable stored seat estimates across 50 states.
- 143 cycles included at least one player candidate.
- Across all 485 consecutive state-cycle transitions, 305 changed at least one party's seat total.
- When both adjacent cycles contained player candidates, 86 of 104 transitions changed at least one party's seat total.
- Restricting control comparisons to transitions with one unique leader in both cycles, 25 of 81 player-present transitions changed the leading party.
- For comparison, 38 of 159 uniquely led transitions changed control when both adjacent cycles were NPP-only.

These counts do not prove calibration is healthy: the query measures observed turnover, not whether the response to a controlled vote swing is correctly sized.

The existing sandbox evidence remains anomalous: `audit-allflags-1953-r3` reported zero leading-party flips across 144 House cycles in 48 states despite vote-share movement and candidate turnover. That result needs a deterministic replay with actor configuration and resolver path recorded.

## Why multiplayer requires separate fixtures

The shared swing-flow engine applies `NPP_GENERAL_WEIGHT_MULTIPLIER` to every NPP when a player is present in the race. Presidential accumulation explicitly supplies `hasPlayerInRace`; the multiplier is applied inside candidate appeal weighting. This makes a multiplayer field behaviorally different from an autonomous field, rather than merely replacing one candidate identity with another.

Primary sources:

- [`presidentialElectionEngine.ts`](https://github.com/Egg3901/AHDGame/blob/development/src/lib/presidentialElectionEngine.ts#L868-L886)
- [`voteDistributionSwingFlow.ts`](https://github.com/Egg3901/AHDGame/blob/development/src/lib/electionEngine/voteDistributionSwingFlow.ts#L175-L202)
- [`voteDistribution.test.ts`](https://github.com/Egg3901/AHDGame/blob/development/src/lib/electionEngine/voteDistribution.test.ts#L1403-L1522)

## Resolver and electoral-system split

[#2124](https://github.com/Egg3901/AHDGame/issues/2124) currently emphasizes generic seat allocation. That is only one path. On current `development`, a redistricting-enabled US House election first calls `districtedHouseResolution`; it uses generic `allocateSeats` only when redistricting is disabled or no district documents are available. Other families use single-winner, proportional, majoritarian-bonus, AMS, PR-STV, bloc-list, or regime-specific resolution. Qualification must group evidence by electoral method, record which resolver executed, and define whether control turnover is expected for that political system.

Primary source: [`generalResolution.ts`](https://github.com/Egg3901/AHDGame/blob/development/src/lib/turn/election/generalResolution.ts#L436-L503)

## Presidential multiplayer evidence

The live world retained six resolved US presidential elections from 1953 through 1972. Every field contained player candidates and no NPP candidates. Party `1` won all six:

| Election year | Player candidates | Stored EV result                      |
| ------------- | ----------------: | ------------------------------------- |
| 1953          |                 4 | 498 to 33                             |
| 1956          |                 3 | 501 to 30                             |
| 1960          |                10 | 530 for the sole EV-winning candidate |
| 1964          |                15 | 446 to 42 to 42                       |
| 1968          |                18 | 280 to 190 to 69                      |
| 1972          |                 8 | 286 to 252                            |

This is not enough to call the winner calculation defective. It is enough to require controlled multiplayer turnover qualification before reset.

The public gamestate trace for the 1972 result showed late unit flips and a stored 286 to 252 outcome, but warned that its reconstructed EV model did not reconcile with the stored result. That mismatch must be classified as election-time apportionment drift, trace-tool drift, or resolution error before it is treated as a game defect.

The existing checkpoint reporter already treats `parliamentSeatsHistory` as the authoritative per-turn presidential control timeline and documents why reconstructing it from resolved elections undercounts the seeded administration. New turnover reporting should extend that source rather than create another timeline.

Primary sources:

- [`presidentResolution.ts`](https://github.com/Egg3901/AHDGame/blob/development/src/lib/turn/election/presidentResolution.ts#L287-L480)
- [`presidentExecutiveSeating.ts`](https://github.com/Egg3901/AHDGame/blob/development/src/lib/turn/election/presidentExecutiveSeating.ts#L70-L319)
- [`checkpointReport.ts`](https://github.com/Egg3901/AHDGame/blob/development/scripts/sim/checkpointReport.ts#L451-L475)
- [Missing presidential winner retry defect #2113](https://github.com/Egg3901/AHDGame/issues/2113)
- [Reset tracker #2159](https://github.com/Egg3901/AHDGame/issues/2159)

## Required qualification matrix

### Legislative and regional races

- Cover competitive single-winner, generic multi-seat, districted House, Commons majoritarian-bonus, AMS, PR-STV, bloc-list, and regime-constrained systems.
- Run House redistricting off and on, with complete and deliberately missing district documents, and record the resolver used.
- Cover NPP-only, one-player-versus-NPP, opposing-player, and mixed same-party player/NPP fields for every player-accessible family.
- Force vote swings across seat thresholds and include an incumbent-hold control.
- Assert party seat totals, individual winners, `electedOfficials`, character/NPP `currentOffice`, district holders, and absence of phantom occupied or stale vacant rows.
- Report control flips, any-seat or office-transfer rate, player/NPP win rate, and resolver-path share per 100 comparable cycles, broken down by election family and political-system expectation.

### Presidential races

- Cover NPP-only, player-versus-NPP, player-versus-player, mixed fields, incumbent re-election, party flip, and contingent resolution.
- Assert stored popular and electoral votes, president/VP office rows, character/NPP `currentOffice`, cabinet transition or preservation, incompatible-office vacancy, tenure ledger, and exactly-once finalization.
- Report party alternation, person turnover, popular margin, EV margin, incumbent hold rate, and player/NPP win shares from the existing snapshots.
- Treat [#2113](https://github.com/Egg3901/AHDGame/issues/2113) as a prerequisite rather than duplicating it.

## Reset implication

The reset tracker should retain #2124 as the cross-system non-presidential turnover blocker and add a separate presidential multiplayer-results blocker. Qualification evidence must record the exact release SHA, preset, feature flags, actor configuration, electoral method/resolver, and election-time apportionment.
