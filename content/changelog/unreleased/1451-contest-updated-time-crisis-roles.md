---
date: 2026-10-10
title: Contests show when standings last updated; crisis cards name the required role
summary: >-
  Each contest card now shows when its standings were last recalculated, and
  the empty-podium message says that nobody has a positive gain yet. Crisis
  response cards list the required office in plain words instead of internal keys.
tags: [contests, crises, ui]
badges: [patch]
areas: [frontend]
---

## What changed

- Contest cards show an "Updated" time next to the entry count. Standings refresh after every turn.
- The empty-podium message now reads "No one has a positive gain yet", which is accurate when entrants exist but all are negative.
- Crisis decision cards that you cannot answer now say, for example, "Requires: Head of state or Cabinet minister" instead of "headOfState, cabinet".
