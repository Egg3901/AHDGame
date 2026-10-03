---
date: 2026-10-04
title: Original-currency GDP in 1991 successor countries
summary: Country GDP comparisons use the opening conversion factor for their seeded local currency.
tags: [1991, economy, currency, gdp]
badges: [patch]
areas: [backend, engine]
---

## What changed

- Poland, Hungary, Czechoslovakia, Romania, Bulgaria and Yugoslavia now normalize their original-currency GDP using their authored 1991 opening parity.
- This corrects country comparisons and market sizing that inherited older conversion factors.
- Seeded GDP amounts, existing financial balances and creditor contracts remain unchanged.
