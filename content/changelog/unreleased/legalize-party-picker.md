---
date: 2026-10-02
title: Pick which banned party to legalize
summary: >-
  The Legalize a banned party reform on the Regime Health tab now has a party
  picker. Before, its Trigger button stayed disabled because there was no way
  to choose a party.
tags: [one-party-state, regime, parties]
badges: [patch]
areas: [frontend, backend]
---

## What changed

- The Legalize a banned party reform lists your country's banned parties. Pick one and press Trigger.
- Each banned party has its own cooldown. A party that is still cooling down shows the turn it becomes available again and can't be picked.
- When no party is banned, the reform says so instead of showing an empty picker.
- The reform now refuses a party that isn't banned before charging anything. Before, a stale request paid the full intra-party cost and legalized nothing.
