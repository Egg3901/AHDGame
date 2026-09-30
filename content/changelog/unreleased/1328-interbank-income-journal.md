---
date: 2026-09-30
title: Durable interbank interest income
summary: >-
  Interbank interest keeps borrower expenses and lender income in the same
  recoverable settlement as the payment and loan update.
tags: [banking, economy]
badges: [patch]
areas: [engine]
---

## What changed

- Realized interbank interest counters are recoverable journal projections.
- Same-turn retries finish recorded accounting work after the loan has advanced.
- Existing interest rates, payments, arrears and default thresholds remain unchanged.
