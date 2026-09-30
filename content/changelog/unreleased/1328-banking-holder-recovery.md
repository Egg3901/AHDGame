---
date: 2026-09-30
title: Make banking recovery and charter funding safer
summary: >-
  Show a recovery message when a savings holder request cannot be delivered,
  and restore the selector for another attempt.
tags: [banking, bugfix]
badges: [patch]
areas: [frontend]
---

## What changed

- Savings holder network errors now show feedback instead of escaping as an unhandled rejection.
- Completed deposits close their form before refreshing balances, including central-bank fallback when the chosen bank is unavailable.
- Add browser qualification of banking commands, settlements, turn outcomes and monetary governance.
- Charter capital now records both cash legs in the Settlement Journal while publishing the funded charter atomically. Interrupted delivery can recover without posting capital twice.
- Renewed charters retain the outstanding loans they continue to service. Concurrent charter or loan changes reject stale publication without charging capital again.
