---
date: 2026-09-08
title: Corporation charts preserve historical exchange rates
summary: >-
  Corporation charts keep recorded cash, revenue, costs and share prices on
  their original exchange rates while the latest market cap uses the live quote.
tags: [corporations, charts, currency]
badges: [patch]
areas: [fullstack]
---

## What changed

- Fixed the latest history point using the live market-cap exchange rate for unrelated historical amounts.
- Kept the live market-cap quote accurate when a corporation changes currency.
