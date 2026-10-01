---
date: 2026-10-01
title: Record bond pool cash movements in the ledger
summary: Bond market liquidity adjustments and issuer payments now leave matching cash records, improving accounting checks across currencies.
tags: [bonds, accounting]
badges: [patch]
areas: [engine]
---

## What changed

- Record successful pool liquidity inflows, sweeps, coupons and maturity receipts using the cash amount and currency actually written.
- Keep modeled liquidity separate from issuer settlement and preserve existing settlement journal ownership.
- Reuse turn context for accounting reads and preserve current cash outcomes when shadow accounting is disabled.
