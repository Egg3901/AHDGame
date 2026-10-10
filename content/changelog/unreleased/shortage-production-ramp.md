---
date: 2026-10-10
title: Plants ramp up properly in deep shortages
summary: >-
  A plant that sells out in a badly short market now ramps toward the real unmet
  demand, and AI corporations can expand in a critical shortage even while their
  plants are running below 85% of capacity.
tags: [corporations, economy]
# How big this change is, which sets how it is grouped in the release post.
# One of: major | minor | patch | hotfix
badges: [minor]
# Which part of the codebase moved. Any of: backend | frontend | fullstack | engine
areas: [engine]
---

## What changed

- When a plant sells everything it makes, it raises output toward the market's unmet demand. That demand figure used to stop at one and a half times supply, so in a deep shortage plants ramped toward a gap far smaller than the real one. It now counts the full shortage, the same figure prices already use.
- AI corporations only expand plants that run at 85% of capacity or more. In a critical shortage that rule no longer blocks expansion, because the low run rate comes from the old ramp limit rather than from weak demand.
- Expect supply of the scarcest goods (retail, real estate services, healthcare, advertising and similar) to climb over the next several game days, and their prices to ease as it does.
