---
date: 2026-09-30
title: Review banking capacity, reserve and rate sensitivity
summary: >-
  Add repeatable banking sensitivity checks covering deposits, lending,
  withdrawals, defaults and insurance using the production settlement rules.
tags: [banking, balance, simulation]
badges: [patch]
areas: [engine]
---

## What changed

- Add funded charter and currency scenarios with per-step cash conservation and retry checks.
- Record depositor outcomes, lender income, insurance costs and explicit central-bank money creation or destruction.
