---
date: 2026-09-24
title: Repair rejected regional bill after funding fix
summary: >-
  Staff can restore a regional bill that passed a veto override but was rejected
  by the old funding check, after confirming the live regional budget can pay for it.
tags: [economy]
badges: [patch]
areas: [backend]
---

## What changed

- Added a guarded preview and repair command for budget-rejected regional bills.
- The repair checks the original vote, current funding, and later laws before applying the passed bill once.
