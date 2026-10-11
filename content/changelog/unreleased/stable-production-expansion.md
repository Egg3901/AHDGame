---
date: 2026-10-11
title: Stabilize plant production and clarify expansion risk
summary: >-
  Plant production responds to fresher sales feedback and shares shortage
  opportunities between suppliers. Expansion advice accounts for unused
  existing capacity and explains why current demand cannot guarantee profits.
# Free text. What the change was about: economy, elections, balance, corporations.
tags: [corporations, economy, construction]
# How big this change is, which sets how it is grouped in the release post.
# One of: major | minor | patch | hotfix
badges: [patch]
# Which part of the codebase moved. Any of: backend | frontend | fullstack | engine
areas: [fullstack, engine]
---

## What changed

- Share shortage headroom within each clearing market instead of promising the full shortage to every seller.
- Use the latest clearing result when responding to demand, while retaining physical limits, contract targets and the existing recovery probe.
- Reserve existing unused capacity and queued construction across output competitors before sizing an expansion.
- Account for technology and Energy productivity when comparing construction capacity with buyer demand.
- Explain changing demand, competing builds, unsold output, idle plants and operating-cost risk in both construction dialogs.
- Correct new-sector guidance that confused unclaimed market share with measured buyer demand.
