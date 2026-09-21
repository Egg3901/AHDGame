---
date: 2026-09-21
title: Reduce routine index fund turn work
summary: Index fund NAV and NPP subscription passes reuse values already loaded for the turn.
tags: [performance, funds]
badges: [patch]
areas: [engine]
---

- NPP fund subscriptions update existing position cost bases without evaluating a Mongo aggregation pipeline for every position.
- NAV processing reuses its fund and bond-principal snapshots instead of loading them again for each fund.
- Fund allocation, unit supply, cash accounting and weighted-average cost basis calculations are unchanged.
