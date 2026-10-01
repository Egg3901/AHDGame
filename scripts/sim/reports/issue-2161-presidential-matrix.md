# Presidential resolution and transition qualification

Issue #2161; reset tracker #2159.

## Executed source and scope

Clean runtime and fixture source: `2842c9143c5ca20ea029e87ed4bc26909a3b3915`.
Both `1991-default` and `2027-default` passed ten deterministic cases each in an isolated simulator Mongo database. The runner rejects a dirty checkout, reused target or non-simulator endpoint and verifies the source again at completion. Actor IDs, votes, calendars and legislative ballots are deterministic. No outbound requests are allowed.

[Machine-readable results](issue-2161-presidential-matrix.json) contain source, preset, actor mix, election-time apportionment, controlled configuration, telemetry version, popular and electoral margins, office-history turnover, tenure, and fault injection results for every case.

This is a controlled resolver qualification. It executes the real vote allocator, contingent ballot, result capture, cabinet transition, executive seating, tenure ledger and office-history writes. Votes are explicit fixtures; other world phases and campaign accumulation are not executed. It is not a replacement for the final release candidate's bootstrap and campaign qualification.

## Matrix

Each row passed in both profiles. Each college contains 538 electoral votes, with the preset's election-year district rules.

| Case                       | Candidate mix | Presidency outcome              | Special assertion                                             |
| -------------------------- | ------------- | ------------------------------- | ------------------------------------------------------------- |
| NPP-only flip              | NPP-only      | New party and person            | NPP office and cabinet transition                             |
| Player beats NPP           | Mixed         | New party and person            | NPP-to-player transition                                      |
| NPP beats player           | Mixed         | New party and person            | Player-to-NPP transition                                      |
| Opposing players           | Player-only   | New party and person            | Player-to-player transition                                   |
| Mixed same-party field     | Mixed         | New party and person            | Competing same-party candidate retained in results            |
| Player incumbent           | Mixed         | Same party and person           | Cabinet preserved, personal and party tenure advance to three |
| NPP incumbent              | Mixed         | Same party and person           | Cabinet preserved, party tenure advances to three             |
| No electoral majority      | Mixed         | House-selected party and person | Actual 50-delegation House ballot and 100-senator VP ballot   |
| Interrupted seating        | Mixed         | New party and person            | Failure after presidential term write, before VP seating      |
| Lost tenure acknowledgment | Mixed         | New party and person            | Durable party-tenure write followed by an injected exception  |

Across the matrix: 16 party alternations, 16 person changes, four incumbent holds, 14 player wins, six NPP wins and two contingent results. All four incumbent fixtures retained office. These are coverage counts, not forecasts of competitive election frequency.

Every case verifies:

- National and per-unit stored votes match the frozen result; stored EV matches allocation using the election-time map.
- Correct president and VP office rows and matching player/NPP `currentOffice`.
- Incompatible Senate offices are vacated through the ordinary vacancy path.
- The incumbent cabinet survives a hold and clears on a new person.
- One presidential/VP career event per election; player term and party tenure counters advance once.
- Both injected failures leave a pending seating that completes on retry. Repeating completed resolution leaves character records unchanged.
- The ordinary `parliamentSeatsHistory` snapshot records the initial administration and the result, with two known holder observations and no missing identity in every case.

The contingent scenarios deliberately choose a president who does not lead the electoral vote. This exposed and repaired a real defect: selecting defeated candidates with `ranked.slice(1)` also treated that House winner as a loser. Defeated history and wiki updates now exclude the actual winner explicitly.

## Retry and reporting repairs

Presidential and VP career writes use an atomic election receipt. Retrying partially completed seating restores office without adding a second term. The party-tenure ledger uses its own election receipt and compare-and-set; seating remains pending until this write succeeds, including a lost acknowledgment after a successful write.

Executive identity is added to the existing per-turn office snapshot, using the same aggregate and bulk write. No query per person is added. Checkpoint reports derive person turnover from this existing timeline, preserving the seeded administration. Older rows without holder identity remain unknown. Reporting also records a full EV margin for a sweep where the losing candidates receive zero electors.

Forty-nine focused tests passed across resolver, seating, incompatible-office, tenure, snapshot and reporting suites. A cold module import exceeded one 15-second local test timeout; the isolated snapshot suite passed with a 30-second limit. Formatting and scoped lint passed. Final CI is tracked by the implementation PR.

## Original 1972 trace warning

A read-only review of the retained 1972 US result classified the discrepancy as trace-tool drift. The stored result is 286 to 252, totaling 538. Its 53 voted units contain Maine districts but only a statewide Nebraska unit. The legacy trace model split Nebraska before its 1992 district-rule start, awarding only two statewide electors and dropping the three absent district electors. Replaying that model reproduces 286 to 249, totaling 535. The corrected trace reconciles 286 to 252 and 538 total.

The legacy tally has no frozen seat map, so this evidence does not independently reconstruct every historical apportionment detail. The missing Nebraska electors fully explain the reported warning. Current controlled fixtures persist and reconcile their election-time maps. No production election was modified.

## Remaining release gate

#2113 is closed. The selected final release still requires this matrix and the source-pinned campaign qualification on its exact source and immutable feature manifest. #2161 and the corresponding #2159 row remain open until that evidence exists.

## Reproduce

Run from the source above against a fresh isolated simulator database:

```sh
SIM_MONGODB_URI=mongodb://127.0.0.1:27018 npx tsx scripts/sim/presidentialMatrixReplay.ts \
  --target=ahd_sim_presidential_unique --out=/tmp/presidential-matrix.json
```
