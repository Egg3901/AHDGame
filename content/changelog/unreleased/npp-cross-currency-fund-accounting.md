---
date: 2026-10-03
title: Fund accounting includes foreign political investors
summary: Cash checks now record fund purchases and sales by non-player politicians whose home currency differs from the fund's.
tags: [accounting, funds]
badges: [patch]
areas: [backend, engine]
---

## What changed

- Record the fund side of index fund purchases and redemptions by non-player politicians investing across currencies.
- Keep player and pension accounts that need a currency conversion on their existing one-sided record.
