---
date: 2026-10-08
title: Corporate tax reaches the treasury in one write
summary: >-
  Each corporate tax payment now updates a treasury's cash and its fiscal
  position together, instead of in two separate steps.
tags: [turns, performance, banking]
badges: [patch]
areas: [backend]
---

## What changed

- When a corporation pays tax, the national treasury's spendable cash and its recorded fiscal position are now updated in the same step. The corporation step of each turn makes about a fifth fewer database calls, and the treasuries end with the same balances as before.
