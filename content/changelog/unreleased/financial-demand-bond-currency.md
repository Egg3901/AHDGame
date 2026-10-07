---
date: 2026-10-08
title: Bond issues count in the right currency for financial services demand
summary: >-
  Government and corporate bond issues add demand for financial services. That
  demand now reads each issue in anchor value instead of its own currency, so
  lira, yen, zloty and Turkish lira issues no longer count hundreds or
  thousands of times too large.
tags: [economy, markets, fix]
badges: [patch]
areas: [backend]
---

## What changed

- Each recent bond issue is converted to anchor value at its own currency's
  rate before it becomes financial services demand. Bonds issued before
  currencies were recorded are already in anchor value and are unchanged.
- In the live 1991 world, Italy's quarterly government issue alone had been
  counting as roughly 3.7 million units of demand, about 68 times what the
  whole world produces. After this change it counts as a few thousand units,
  in line with dollar, pound and mark issues of the same size.

## What players will notice

- The world price of financial services comes off its 3x ceiling over the
  following turns, so bank and finance company revenue falls back toward what
  their actual business supports.
- Costs that include financial services ease, which takes some pressure off
  inflation.
