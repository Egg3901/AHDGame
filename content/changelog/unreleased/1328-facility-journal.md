---
date: 2026-09-30
title: Reliable central-bank liquidity and facility servicing
summary: >-
  Central-bank liquidity operations keep their original delivery record across
  retries. Facility servicing preserves the original interest and arrears.
tags: [banking, economy]
badges: [patch]
areas: [fullstack, engine]
---

## What changed

- Liquidity requests retain one operation identity through retries and recovery.
- Bank advances, debt, receipts and operation history use durable settlement records.
- Facility interest retains its original payment, arrears and income accounting.
- Existing rates, allocation and cooldown policies remain unchanged.
