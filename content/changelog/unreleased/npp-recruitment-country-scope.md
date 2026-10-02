---
date: 2026-10-02
title: Fix country isolation in NPP recruitment capacity
summary: >-
  Party recruitment now counts only NPPs in the party's own country.
  Foreign parties sharing a party number no longer inflate capacity usage or block recruitment.
# Free text. What the change was about: economy, elections, balance, corporations.
tags: [parties, recruitment]
# How big this change is, which sets how it is grouped in the release post.
# One of: major | minor | patch | hotfix
badges: [patch]
# Which part of the codebase moved. Any of: backend | frontend | fullstack | engine
areas: [backend]
---

## What changed

- Scope national and regional recruitment counts and the region picker to the requested country.
- Apply the same country filter when enforcing party capacity and regional recruitment slots.
- Preserve recruitment counts for legacy US NPPs without a country field.
- Add regression coverage for shared party numbers, retired NPPs, and legitimate capacity limits.
