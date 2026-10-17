---
date: 2026-10-16
title: Carry UK government confidence through government changes and add history
summary: >-
  Government confidence now carries forward with a small formation boost rather
  than resetting to full. A new history chart shows recorded changes without
  inventing values from before the update.
# Free text. What the change was about: economy, elections, balance, corporations.
tags: [government confidence, elections, balance]
# How big this change is, which sets how it is grouped in the release post.
# One of: major | minor | patch | hotfix
badges: [patch]
# Which part of the codebase moved. Any of: backend | frontend | fullstack | engine
areas: [backend, frontend]
---

## What changed

- Successor governments inherit the outgoing confidence value and recover 10%
  of the remaining distance to 100. Confidence remains unchanged through the
  election and caretaker period.
- The UK executive page now shows recorded turn and event history. Older values
  were not stored and are not reconstructed; history is bounded to 500 points.
