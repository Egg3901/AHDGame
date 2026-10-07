---
date: 2026-10-07
title: Preserve account identity and cohort context in optional analytics
summary: >-
  Optional gameplay analytics now distinguish account age from character age
  and keep activity separated when accounts change on the same browser.
tags: [analytics, privacy]
badges: [patch]
areas: [frontend]
---

## What changed

- Reuse account creation dates and role flags in consented gameplay events.
- Identify accounts consistently in both analytics destinations and reset identity on logout or consent withdrawal.
- Discard stale pending work when accounts change, and bind registration markers to the created account.
