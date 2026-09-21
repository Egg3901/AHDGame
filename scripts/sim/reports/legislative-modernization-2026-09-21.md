# Legislative modernization simulation report

Date: 2026-09-21

Scope: deterministic accounting, delivery, jurisdiction, grant, regional underfunding, and
catalog-parity mechanics. These fixtures validate rules. They do not approve production balance
constants or evaluate the merits of any policy.

## Catalog inventory

| Country | Laws | Options | Program options | Departments | Authored political-board baseline |
| ------- | ---: | ------: | --------------: | ----------: | --------------------------------- |
| US      |   68 |     491 |             339 |          14 | Yes                               |
| UK      |   63 |     468 |             378 |          14 | Yes                               |
| JP      |   64 |     475 |             378 |          12 | No                                |

All 195 law types have explicit scope and administration metadata. All fourteen shared
portfolios resolve to an institution in each country. Every cost-bearing option has program
metadata and an authored outcome target.

The machine-readable metric inventory contains 202 paths: 43 owned by `macroMetrics`, 96 legacy
compatibility paths, and 63 political-board families. Legislation references 122 registered paths
and no unknown path. Exact-slug comparison finds one unresolved overlap candidate,
`social.socialMobility` and `society.socialMobility`. The inventory records that relationship but
does not alias or retire either path without a consumer migration decision.

The Japan row is a migration fact, not a parity rating. Japan can use the derived political-board
pipeline, but it is not included in `POLITICAL_METRIC_COUNTRY_IDS` and has no authored baseline
anchor equivalent to the US and UK. The canonical-metric gate must remain off until that migration
choice is made and validated.

## Deterministic scenarios

| Scenario                   | Result                                                                            |
| -------------------------- | --------------------------------------------------------------------------------- |
| Full funding               | 200 authorized, 200 outlaid, zero unexplained balance                             |
| Appropriation shortfall    | Two same-tier programs each deliver 40% under an 80-of-200 envelope               |
| High funding, low capacity | 50% delivery, capacity is the reported binding constraint                         |
| High capacity, low funding | 40% delivery, funding is the reported binding constraint                          |
| Cabinet allocation         | A 70/30 allocation divides a 100 envelope into 70 and 30 after protected claims   |
| Regional baseline          | A 100 program receives 100 and delivers fully                                     |
| Regional revenue shock     | The 100 authorization remains enacted; funding falls to 40 and delivery to 40%    |
| Grant transfer             | 20 reserved plus 100 program funding reconciles to the 120 regional budget        |
| Government turnover        | Department identity is unchanged because the account is institution-owned         |
| Cross-stance compatibility | No conflict occurs without a shared policy family or conflict-set id              |
| Country mechanics parity   | The same 80-of-100 fixture produces the same 80% implementation in US, UK, and JP |

## Invariants

- National sources equal outlays plus closing balance.
- Cabinet allocations cannot move a current program ahead of a senior legal tier.
- Regional funded spending never exceeds available regional budget.
- A revenue shock scales delivery and does not silently repeal the law.
- Conflict resolution does not read stance labels.
- Grant delivery is read from the national department sub-ledger and is not charged to the
  sovereign a second time.
- Same-turn and stale settlement paths fail closed.

## Command

```text
npx tsx scripts/sim/legislativeModernization2026-09-21.ts
```

The corresponding Vitest file fails if any invariant changes.

## Isolated Mongo evidence

The generalized turn shell was run against the designated `MONGODB_URI` test server using a
unique `ahd_leg_mod_*` database. The harness created one national program for each of the US, UK,
and Japan, settled turn 10, replayed turn 10, and dropped the fixture database.

| Observation                         | Result |
| ----------------------------------- | -----: |
| Countries settled                   |      3 |
| Departments settled                 |      3 |
| Programs settled                    |      3 |
| Authority accrued                   |    180 |
| Outlaid                             |     90 |
| Closing encumbrance                 |      1 |
| Replay authority                    |      0 |
| Replay outlay                       |      0 |
| First settlement round trips        |     22 |
| First settlement documents returned |     20 |
| First settlement response bytes     | 12,092 |
| Replay round trips                  |     19 |
| Replay documents returned           |     20 |
| Replay response bytes               | 14,808 |

Assertions passed: every country settled; the replay added no flow; persisted state was identical
after replay; national treasury balances were unchanged by the sub-ledger settlement; every
department balance and encumbrance was non-negative; and the URI default database collection set
was unchanged.

The department phase remains below its current default round-trip budget of 500. The fixture
contains one law and one region per country, so these counts establish bounded query shape rather
than a production-volume ceiling.

## Remaining balance evidence

Production capacity pools, source shares, ramp profiles, and carryover behavior are still
provisional. Before the rollout gates are enabled on a persistent world, run the full multi-turn
world simulation and the turn round-trip profiler against a populated disposable database. Record
documents, bytes, and round trips for the new department phase.
