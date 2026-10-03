---
date: 2026-10-03
title: Faster supply contract matching and settlement
summary: >-
  The turn steps that match NPP supply contracts and settle all supply
  contracts now do the same work far faster. Matches and deliveries are
  unchanged.
tags: [performance, turns, corporations]
badges: [patch]
areas: [backend]
---

## What changed

- NPP supply-contract matching looks up existing contracts from one index per turn instead of re-reading the whole contract book for every supplier and buyer it considers. On the live book this took the matching from about 30 seconds of work to under 2 in a full pass.
- Contract delivery allocation reuses its working memory between steps and runs four to five times faster, with identical deliveries.
