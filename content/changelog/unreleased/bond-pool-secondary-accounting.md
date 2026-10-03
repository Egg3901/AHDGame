---
date: 2026-10-03
title: Bond market accounting includes secondary trades and refunds
summary: Cash checks now include the bond pool side of purchases, sales and returned payments.
tags: [accounting, bonds]
badges: [patch]
areas: [backend, engine]
---

## What changed

- Record actual secondary bond market cash alongside buyer and seller balances.
- Record returned pool payments, including guarded sale retries.
- Share accounting reads and batch publication across each turn phase.
- Include transactional fund purchases in the same cash accounting.
