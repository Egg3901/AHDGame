---
date: 2026-10-03
title: Ranked ballot election counting
summary: >-
  Explicitly selected ranked elections now count surplus and eliminated votes
  from stored preferences and record each count. Existing aggregate elections
  retain their current counting method.
tags: [elections, pr-stv]
badges: [minor]
areas: [engine, backend]
---

## What changed

- Added an explicitly selectable ranked PR-STV path for Irish Dail and local council races with distinct candidates.
- Ballots, projections, elected officeholders and election history agree, with deterministic ties and retry guards.
- Missing preference evidence and incomplete candidate fields stop resolution before incumbents are removed.
