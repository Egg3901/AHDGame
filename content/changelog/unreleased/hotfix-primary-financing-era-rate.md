---
date: 2026-10-01
title: Bond payments resume for countries outside the currency market
summary: >-
  Sovereign bond sales by countries without a traded currency no longer stop bond processing for the turn.
tags: [bonds, bugfix]
badges: [patch]
areas: [backend]
---

## What changed

- Countries whose currency is not traded on the exchange price new bond sales at their historical exchange rate, so coupon and maturity payments continue every turn.
