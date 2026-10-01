# Fresh 2027 living-crisis continuation

Issue #2159, second 2027 crisis row. This supplements the authored opening and first-turn proof in [the opening report](issue-2159-2027-crisis-opening.md), the accepted [framework](issue-2150-framework-acceptance.md), and the existing family acceptance evidence.

## Executed source and scope

Runtime and replay source: `d5601772a31a98430ba707b1ca2b6e74e01dd301`, 30 September 2026. The committed `scripts/sim/replay2027CrisisOpening.ts` completed with exit 0 against the dedicated loopback sandbox MongoDB at `127.0.0.1:27018`. The synthetic databases have unique `ahd_sim_issue2159_crisis2027_*` names. Raw JSON is retained with the private acceptance evidence. The ordinary cohort advances from January 2027 through 51 more game turns, crossing into 2028 at the configured 48 turns per year.

The replay runs production `driveConflictTurn`, `materializeLivingConflictEvent`, Northern Ireland interaction default resolution, and `resolveGlobalResponse` from the exact inherited states. It resolves an expiring window before another event for the same family can open. Every ordinary-cohort driven turn and opened materialization is retried, and completed global resolutions are retried without a second response or effect. It does not execute unrelated economy, election, or full-world phases.

| 2027 family                             | Materialized windows | Resolved windows | Inherited phase observed                                 |
| --------------------------------------- | -------------------: | ---------------: | -------------------------------------------------------- |
| Northern Ireland                        |                    2 |                1 | Power sharing                                            |
| Transnational terrorism                 |                    2 |                1 | Network degradation                                      |
| Pandemic                                |                    4 |                3 | Endemic management                                       |
| Arab uprisings                          |                    2 |                1 | Proxy escalation, with five independently seeded origins |
| Russia/Ukraine security                 |                    2 |                1 | Broad war                                                |
| Yugoslav dissolution, absent federation |                    0 |                0 | Closed, not applicable                                   |
| Historical financial/euro crisis        |                    0 |                0 | Closed, settled                                          |

The second window of each 24-turn family is still active at the 51-turn endpoint. Every continuing family has at least one completed resolution. No expired initial-phase event fires. The previous #2150 and family-specific acceptance reports establish player option authorization, alternative decisions, treasury effects, recovery, and retry behavior on retained subsystem worlds; this replay establishes that the newly authored inherited 2027 phases reach their real materializer and resolution paths. Those earlier reports do not claim a full-world continuation of this new seed.

The family evidence is recorded in [Northern Ireland](issue-2151-northern-ireland-acceptance.md), [terrorism](issue-2153-terrorism-acceptance.md), [financial crisis](issue-2154-financial-acceptance.md), [pandemic](issue-2155-pandemic-acceptance.md), [Russia/Ukraine](issue-2156-security-acceptance.md), and [Arab uprisings](issue-2157-arab-uprisings-acceptance.md). The surviving-Yugoslavia and missing-Ukraine public paths below are new evidence from this replay.

## Counterfactual and participant authority

A separate synthetic sandbox database adds a surviving Yugoslav federation at the actual 2027 start turn. Its explicitly counterfactual seed opens a `federal_crisis` event and a real global response window. A synthetic seated US president obtains the normal `headOfState` role, submits the authored `west_mediate` public choice, and reaches the production `negotiated_restructuring` outcome at the 24-turn deadline. A wrong-role attempt and duplicate submission both reject. This is a game counterfactual, not a claim that the historical Yugoslav federation survived.

In the same isolated branch, Ukraine is unavailable while Russia remains present. The participant resolver reserves Russia's backer role and chooses Poland for the affected sovereign role. The materialized security window assigns Poland `belligerent` and Russia `backer_a`; a synthetic seated Polish president obtains normal authority, submits the authored `uk_neutral` choice once, and resolves to the modeled `negotiated_neutrality` outcome at its 2028 deadline. Duplicate submission rejects. The test assigns no future military winner.

The five-family continuation uses default responses on a deliberately small synthetic population. Detailed player-choice outcome variation, fiscal flows, and full-world performance remain evidenced by the accepted child reports or by separate #2158/#2159 gates, not by this 51-turn fixture.
