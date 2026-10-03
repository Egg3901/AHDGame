---
date: 2026-10-03
title: Faster supply contract settlement each turn
summary: >-
  The corporation turn settles supply contracts and saves sector results faster, with identical results.
tags: [performance]
badges: [patch]
areas: [backend]
---

## What changed

- Matching each supplier's delivered goods to its contract buyers runs about twice as fast, and still picks exactly the same deliveries.
- Contract delivery records and sector results are saved in a few parallel batches instead of one long queue, with the same final records.
