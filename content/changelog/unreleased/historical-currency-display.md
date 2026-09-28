---
date: 2026-09-28
title: Preserve historical currency values in displays and inputs
summary: >-
  Historical money displays now convert amounts together with their units.
  German mark displays and euro displays use the correct rates, while existing
  Irish-pound and normalized accounting balances retain their denominations.
tags: [currency, historical-worlds]
badges: [patch]
areas: [frontend]
---

- Convert German euro-equivalent accounting amounts into marks for local historical displays.
- Use the euro rate when displaying an Irish-pound account in euros; explicit IEP displays remain in Irish pounds.
- Identify normalized Brazilian accounting units without inventing a cruzeiro exchange rate.
- Keep historical charts, displayed amounts, order inputs and donation inputs consistent.
- Preserve stored balances and contracts.
