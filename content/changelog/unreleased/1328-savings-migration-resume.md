---
date: 2026-09-30
title: Resume interrupted savings migration
summary: >-
  Savings migration recognizes backing already delivered and recovers its
  original pending transfers before planning the remaining accounts.
tags: [banking, economy]
badges: [patch]
areas: [engine]
---

## What changed

- Completed migration receipts no longer require the household pool to fund the same backing again.
- Interrupted migrations finish their original transfers before calculating remaining backing.
- Existing shadow accounts still require backing, and migration recovery retains the authoritative-mode and currency-cohort gates.
