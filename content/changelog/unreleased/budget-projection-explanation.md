---
date: 2026-09-08
title: Explain the finance minister's budget projection
summary: >-
  The finance minister's projection now states its GDP, inflation and demographic
  assumptions, and explains when a shrinking economy raises debt-to-GDP even
  before accounting for new borrowing.
tags: [budget, government, interface]
badges: [patch]
areas: [frontend]
---

## What changed

- Show the growth and spending assumptions used by the projected budget card.
- Explain the denominator effect on projected debt-to-GDP during a contraction.
- Use one shared spending-drift constant for both the calculation and its copy.
