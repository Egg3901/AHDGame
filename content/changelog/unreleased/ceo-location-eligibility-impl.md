---
date: 2026-10-15
title: Enforce corporation CEO residency
summary: >-
  Human CEO appointments for subsidiaries now enforce the corporation's residency
  rules, caretaker recovery rechecks eligibility, and the CEO election explains
  the HQ-region requirement.
# Free text. What the change was about: economy, elections, balance, corporations.
tags: [corporations, ceo]
# How big this change is, which sets how it is grouped in the release post.
# One of: major | minor | patch | hotfix
badges: [patch]
# Which part of the codebase moved. Any of: backend | frontend | fullstack | engine
areas: [backend]
---

## What changed

- Enforced headquarters-state and country eligibility for human subsidiary CEOs,
  and rechecked eligibility when restoring a former CEO from an NPP caretaker.
- Clarified that a candidate must live in the HQ region to become CEO.
