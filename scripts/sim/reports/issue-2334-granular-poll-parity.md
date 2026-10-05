# Issue 2334: granular poll rule-kernel parity

## Scope and method

The deterministic harness `scripts/sim/issue-2334-granular-poll-parity.ts` compares granular poll candidate shares with the election vote-distribution flow across four office families (governor, House, Senate, president), human/human and human/NPP actor mixes, four favorability cases, and before/after campaign timing. It emits 64 scenario rows. For each row it also checks both candidates' selected personal-stat tenure retention against the same pure rule selector used by the tally flow (128 candidate comparisons).

The controlled tenure fixtures exercise executive consecutive terms, a sought Senate term versus the held-term ledger, and House tenure keyed by the actual election candidate ID. Presidential reach uses national influence as the presidential driver does; other offices use political influence. The presidential fixture sets incumbent approval to the existing neutral pivot so the separate incumbent persuasion shield does not contaminate the personal-stat-retention comparison.

## Evidence

Run with `npx tsx scripts/sim/issue-2334-granular-poll-parity.ts`. On the current source revision it completed all 64 scenarios. The original non-incumbent governor subset remains within the issue's 0.5 percentage-point bound: maximum absolute final-share delta is 0.050 pp. Across the deliberately controlled scenarios, the maximum final-share delta is 0.202 pp. All 128 poll-versus-tally personal-stat tenure selector comparisons match exactly (maximum retention delta 0.000).

The incumbent total-share deltas are reported separately from the rule-kernel comparison. The harness aligns the personal-stat retention inputs but does not assert that a poll predicts the final election margin: the tally also applies independent mechanics such as the incumbency persuasion shield, candidate reach normalization/floors, and other office-specific effects. The presidential fixture neutralizes the shield only to isolate retention. The 0.202 pp maximum is therefore a result for these pinned scenarios, not a statistical calibration claim or evidence of population-wide coverage.

## Focused checks

The focused Vitest run passed 103 tests across the granular payload, poll route, opponent context, tenure selector, and vote-distribution-flow suites (`--maxWorkers=2`). The route test verifies that the official presidential incumbent party, matching consecutive-term count, candidate identity, and national-influence selection reach the poll payload. The opponent test verifies House tenure uses preloaded election identity data without per-opponent reads. No full repository checks or production simulation were run.
