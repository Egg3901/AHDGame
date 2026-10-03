---
date: 2026-10-03
title: Faster NPP action turns
summary: >-
  The every-fourth-turn NPP action step now builds party organisation in each
  country at the same time and processes NPP share sales in each currency at
  the same time. Who builds, who sells, and the results are unchanged.
tags: [performance, turns, npps]
badges: [patch]
areas: [backend]
---

## What changed

- NPP party-organisation building decides every build first, as before, then carries the builds out country by country in parallel. Each country keeps its original order.
- NPP share sales decide every sale first, as before, then settle currency by currency in parallel. Each currency keeps its original order.
- NPP cash and share updates no longer send the whole record back when only a balance or the shareholder list is needed.
