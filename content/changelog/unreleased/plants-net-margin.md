---
date: 2026-10-03
title: Plants sectors show an ordinary net margin
summary: >-
  The margin that counts unsold output is now profit over revenue, so it reads
  like any other net margin instead of running to thousands of percent.
tags: [corporations, economy, interface]
badges: [patch]
areas: [frontend]
---

## What changed

- On plants worlds, the sector table, the Overview and Financials margin columns, the CEO operations table and the sector page now show net margin: profit over revenue, after paying for everything the sector made, unsold output included. It is at most 100% and goes negative when a sector loses money.
- It used to be profit over total cost, which ran to four or five figures for a sector with very low upkeep.
- A sector that sold nothing while still paying its costs shows -999.9%.
- Display only: nothing in the turn reads this figure.
