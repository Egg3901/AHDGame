---
date: 2026-09-06
title: Maine and Nebraska stop voting three and four times
summary: >-
  Every presidential electoral unit drew its electorate from its parent state,
  so once the district split activated Maine's three units and Nebraska's four
  each polled the whole state. Both states contributed several times over to
  the national popular vote.
tags: [elections]
badges: [patch]
areas: [backend]
era: "Beta 2"
---

Cut from development.

## Fixed

- Congressional-district units now draw their share of the state electorate
  rather than all of it. Maine splits two ways, Nebraska three, from the live
  house-seat count, so a reapportionment re-splits them correctly instead of
  staying pinned to the seeded number.
- The at-large leg is no longer simulated at all. Its tally is summed from that
  state's districts, which is both the real rule — two electors decided by the
  statewide total — and the only way to avoid counting those ballots twice.
  Scaling the districts alone would still have double counted against it.
- The whole-state units every other state uses are unchanged, and 1953 worlds
  are untouched: Maine did not adopt the district method until 1972, Nebraska
  not until 1992.

## Changed

- The three seeded unit bundles and the live year-gated builder now share one
  `ElectoralVoteUnit` type and one construction path, so the district rule
  cannot drift between the seed and the live apportionment.
