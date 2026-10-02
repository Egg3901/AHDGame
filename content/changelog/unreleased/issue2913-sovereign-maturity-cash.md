---
date: 2026-10-02
title: Pay sovereign bond principal from treasury cash
summary: >-
  Governments now pay matured sovereign principal from treasury cash as well
  as retiring the debt. Repayment records use the same currency valuation as
  treasury accounting.
# Free text. What the change was about: economy, elections, balance, corporations.
tags: [bonds, treasury, accounting]
# How big this change is, which sets how it is grouped in the release post.
# One of: major | minor | patch | hotfix
badges: [patch]
# Which part of the codebase moved. Any of: backend | frontend | fullstack | engine
areas: [engine]
---

## What changed

- Debit principal redemption in the same atomic budget write that retires debt.
- Preserve existing holder payouts and haircut-adjusted debt retirement.
- Record government repayment only when the budget cash operation lands.
- Reject mismatched currencies before settlement and preserve signed treasury balances.
