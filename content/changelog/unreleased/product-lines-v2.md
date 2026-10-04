---
date: 2026-10-04
title: Add gated manufacturing product projects
summary: >-
  Manufacturing corporations can develop one product project across their
  eligible plants, then redirect a bounded share of recipe value into its
  modeled commodity output. Development requires paid R&D and at least 12 turns.
# Free text. What the change was about: economy, elections, balance, corporations.
tags: [corporations, manufacturing, economy]
# How big this change is, which sets how it is grouped in the release post.
# One of: major | minor | patch | hotfix
badges: [patch]
# Which part of the codebase moved. Any of: backend | frontend | fullstack | engine
areas: [fullstack]
---

## What changed

- Added gated manufacturing product projects with plant-backed allocations, legal strategy checks, a player studio, and NPP selection based on margin, scarcity, and existing recipe exposure.
- Development costs 5% of allocated plant capital and requires 12 elapsed turns. Only funded R&D advances the project; unpaid development spend cannot push cash below zero, and the remaining R&D spend continues to general research.
- Product stages redirect a bounded share of nominal recipe value while conserving total output value and using live sector quality. The feature flag defaults off.
