# Issue #1343 UK party-tier threshold scenario simulation

Date: 2026-09-23

Command: `npx tsx scripts/sim/issue1343PartyTierThreshold.ts`

The deterministic scenario sweep feeds the production party-tier rules twelve
UK regions and tests Minor parties with 0 through 5 regions at exactly 20% Org.
It compares the current one-third threshold with the proposed UK one-quarter
threshold and checks that a non-UK country still uses the default threshold.
Absent regions count as 0% Org.

| Regions at 20% Org | Current UK rule | Proposed UK rule | Other country |
| -----------------: | --------------- | ---------------- | ------------- |
|                  0 | minor           | minor            | minor         |
|                  1 | minor           | minor            | minor         |
|                  2 | minor           | minor            | minor         |
|                  3 | minor           | major            | minor         |
|                  4 | major           | major            | major         |
|                  5 | major           | major            | major         |

The change moves the UK's threshold from 4 of 12 regions (33.3%) to 3 of 12
(25%). Only the boundary scenario at three regions changes tier. In a separate
at-risk scenario with four regions at 15% Org and eight regions below 10%, both
rules start the same Major-party demotion warning. Per-region Org requirements,
earned-region caps, and the 240-turn demotion grace period are unchanged.

This is a threshold scenario simulation, not a forecast of votes, seats, or
historical party trajectories. It uses synthetic party footprints and no live
or player data.
