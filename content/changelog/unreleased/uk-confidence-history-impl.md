---
date: 2026-10-16
title: Preserve government confidence and show history across government types
summary: >-
  Parliamentary government confidence now carries forward with a small formation
  boost rather than resetting to full. Executive pages also show recorded
  government-confidence or approval history using each system's existing measure.
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
- Parliamentary executive pages now show recorded turn and event history.
  Older values were not stored and are not reconstructed; history is bounded
  to 500 points.
- Presidential executive pages now chart the existing national government
  approval snapshots. One-party states continue to show ruling-party confidence
  history, which is distinct from parliamentary government confidence.
