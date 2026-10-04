# Democratic 1991 parliamentary bill dispatch qualification

Issue: #2488. Runtime source: `ada0fd1bd0`. Executed 2026-10-03. This qualifies the existing configured bill lifecycle on bounded fixtures, not a historical-law audit or whole-world simulation.

The production country registry already dispatches Poland, Czechoslovakia, Hungary, Romania, Bulgaria and Yugoslavia through the one-party entry point. Their authored 1991 governments are democratic. The old runtime guard therefore returned before processing any bill. The dispatch now runs the existing era-aware ordinary chamber graph for these six 1991 configurations without one-party confidence, purge, legitimacy or escalation ticks. Other converted one-party countries retain their stop guard.

Missing country-state recovery now reads the canonical world's preset before seeding. Existing persisted political settlements retain priority and the request's cache still avoids repeat reads. Retired federations with a `dissolvedTurn` do not process legislation. Pending government formations use the engine's existing freeze.

## Verified behavior

The targeted regression run passes 79 cases across six suites. Nineteen new stateful journeys cover all six countries' enactment and first-chamber refusal, second-chamber refusal in Poland, Czechoslovakia and Romania, Romania's presidential timeout, repeat dispatch, retired federations, pending governments and the converted Chinese guard. Current officeholders' seat weights replace stale aggregate vote totals and the engine stores frozen snapshots. Seven country-state/cache cases include a missing Hungarian record recovering as a parliamentary republic in a 1991 world. Existing one-party and configured graph regressions pass.

Six additional real isolated-Mongo journeys independently exercise the same dispatch. They confirm lower-chamber vote custody, second-chamber progression where configured, Romania's presidential window, one-time law completion, foreign-bill isolation and absence of one-party leader or purge writes. Synthetic databases are dropped after each case. The six Mongo journeys run in the permanent hosted transaction qualification job.

Scoped integration TypeScript, touched lint and formatting pass. The architecture audit has zero blocking findings and 66 existing warnings. One combined local regression run exceeded the old crossover suite's dynamic-import timeout; rerunning the final targeted regression cohort passes all 79 cases without increasing timeouts. The Mongo cohort passes independently. No dependencies were added.

## First-stage performance

Measured with driver command monitoring and BSON sizes, excluding fixture setup and assertions. The prior democratic guard only read the country-state document and did no legislative work. The restored first-stage dispatch includes that read, the retirement marker, engine reads and actual transitions:

| Country        | Commands | Command bytes | Reply bytes |
| -------------- | -------: | ------------: | ----------: |
| Poland         |       13 |         5,943 |       4,034 |
| Czechoslovakia |       13 |         6,065 |       4,094 |
| Hungary        |       10 |         4,423 |       3,379 |
| Romania        |       14 |         6,567 |       4,300 |
| Bulgaria       |       10 |         4,423 |       3,377 |
| Yugoslavia     |       10 |         4,519 |       3,371 |

These are single-bill fixture operations, not whole-turn performance. No new query per deputy is introduced. The existing phase budget is unchanged. Reporting counts signed laws as enacted; a first chamber's approval alone is not enactment.

## Remaining parent criteria

This repair restores the authored ordinary graphs. It does not make those graphs a complete statutory model of each country's vetoes, constituent decisions or federal chamber competences. Later Hungarian electoral reform decisions, coalition lists, legacy candidature reconciliation, Bulgarian founding and early-dissolution mechanics, Romanian seat transitions, Polish dissolution decisions and fresh source-pinned whole-world acceptance remain open in #2488 and the wider repair program.
