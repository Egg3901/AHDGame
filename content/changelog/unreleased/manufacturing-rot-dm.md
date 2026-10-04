---
date: 2026-10-04
title: Share product lifecycle stage progression
summary: >-
  Manufacturing product development now uses a portable shared lifecycle rule
  for paid progress, elapsed development, replay safety, and stage timing.
# Free text. What the change was about: economy, elections, balance, corporations.
tags: [products, manufacturing, lifecycle]
# How big this change is, which sets how it is grouped in the release post.
# One of: major | minor | patch | hotfix
badges: [minor]
# Which part of the codebase moved. Any of: backend | frontend | fullstack | engine
areas: [backend, engine]
---

## What changed

- Extracted product stage progression into a pure industry-neutral rule. The manufacturing adapter keeps the existing paid cash, 12-turn development gate, and stage effects while delegating receipt validation and transitions to the shared rule.
- A settled zero-spend turn may advance elapsed time, but cannot satisfy a development cost. Wrong-project, stale, and replayed receipts do not change lifecycle state.
