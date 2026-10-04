---
date: 2026-10-03
title: Shorter turns from overlapping small steps
summary: >-
  Several small turn steps that never touch the same records now run side by
  side, and a few steps read or write their records in one go instead of one at
  a time. Turn results are unchanged.
tags: [performance, turns]
badges: [patch]
areas: [backend]
---

## What changed

- Caucus taxes and the national treasury update now run at the same time.
- NPP bill sponsorship and the filing of primary challengers now run at the same time. Both still finish before NPPs vote.
- The market and wealth snapshots at the end of the turn no longer wait for the metric, approval, interest rate and party history snapshots.
- The end-of-turn health check runs its consistency checks together and reads each budget record once.
- Cabinet estates for every seat are read in a single pass.
- Party GOTV, suppression and registration spending is recorded in one write instead of one per party.
