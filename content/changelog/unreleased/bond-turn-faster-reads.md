---
date: 2026-10-03
title: Faster bond turn processing
summary: The bond step of each turn reads less data and makes far fewer database trips, with the same results.
tags: [bonds, performance]
badges: [patch]
areas: [backend]
---

## What changed

- Bond market pools now load every sovereign issuer's credit picture in one pass instead of country by country.
- Bond price history looks up each bond's interest to date directly instead of rereading its whole history every turn.
- Placing unsold sovereign bonds checks for earlier settlements once per turn and reads only the budget figures it needs.
