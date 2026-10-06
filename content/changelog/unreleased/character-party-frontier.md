---
date: 2026-10-06
title: Party geography checks during signup and relocation
summary: >-
  Starting party choices now respect nearby party presence. Relocating outside
  your party's reach requires confirmation that you will become Independent.
# Free text. What the change was about: economy, elections, balance, corporations.
tags: [parties, character-creation, relocation]
# How big this change is, which sets how it is grouped in the release post.
# One of: major | minor | patch | hotfix
badges: [patch]
# Which part of the codebase moved. Any of: backend | frontend | fullstack | engine
areas: [frontend, backend]
---

## What changed

- Character creation checks party eligibility before saving membership, and the party picker updates when the home region changes.
- Moving outside party reach requires explicit confirmation, including when moving with a corporation. Confirmed departures clear party influence and party-only roles.
- Leaving does not start a new party-join cooldown. Existing cooldowns continue to apply.
