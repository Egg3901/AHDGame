---
date: 2026-10-09
title: Freight is billed once a day, not once a turn
summary: >-
  Sectors were charged a full day's shipping bill every turn, 24 times what
  they owed, and freight haulers were paid the same inflated amount. Both sides
  now move one day's freight per day.
tags: [economy, logistics, corporations]
badges: [patch]
areas: [backend]
---

## What changed

- The shipping bill for goods hauled between states is now spread over the day's turns. Before, the whole day's bill was charged on every turn, so freight costs were 24 times too high.
- Haulers' freight income is corrected the same way, so the money still moves from buyers to haulers in full, just at the right size.
- The freight figures on sector pages are now a true daily amount.
