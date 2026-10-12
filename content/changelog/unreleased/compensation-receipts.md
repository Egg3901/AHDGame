---
date: 2026-10-12
title: Compensation payments now show up in your company's transactions
summary: >-
  When the team repays a company for money a bug cost it, the payment now
  appears in the company's transaction history as a restitution credit.
tags: [corporations, economy]
badges: [patch]
areas: [backend]
---

## What changed

- Repayments for money lost to a game bug are now paid through one tracked path. Each payment adds the exact amount to the company's cash and records a Restitution Credit in its transaction history, so it is clear where the money came from.
- A repayment is recorded once per company and cannot be paid twice by accident.
