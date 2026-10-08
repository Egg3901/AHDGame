---
date: 2026-10-08
title: Profitable corporations settle income and tax in one step
summary: >-
  A profitable corporation's turn income and its tax payment now settle
  together, instead of as two separate payments.
tags: [turns, performance, banking]
badges: [patch]
areas: [backend]
---

## What changed

- A profitable corporation with no unpaid bills used to receive its income first and then pay its tax as a second payment. Both now settle in one step: the corporation receives its income after tax, and the treasury receives the tax. The corporation step of each turn makes about a quarter fewer database calls.
- Corporations with unpaid bills, a loss, or negative cash still receive income first and pay tax second, so unpaid tax is still recorded as owed exactly as before. Corporations and treasuries end with the same balances as before.
