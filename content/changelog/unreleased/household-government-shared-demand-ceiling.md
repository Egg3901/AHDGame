---
date: 2026-10-08
title: Households and governments now share one demand ceiling
summary: >-
  Health care and entertainment no longer read three times their supply when
  households and governments both hit their purchase limit.
tags: [economy, balance]
badges: [patch]
areas: [backend]
---

## What changed

- Households and governments both buy health care and entertainment, and each
  had its own limit of 1.5 times last turn's supply. In a short market both
  limits filled, so those goods showed three times their supply in demand and
  the gap could not close however much capacity was built.
- Both now share the single 1.5 times limit. Households are served first and
  government buys what is left. The shortage still shows in the market and in
  the build signals for companies.
