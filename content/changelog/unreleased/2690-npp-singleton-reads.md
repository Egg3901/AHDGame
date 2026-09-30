---
date: 2026-09-30
title: Faster politician turn processing
summary: >-
  Computer-controlled politicians check game settings once per turn instead of once per decision.
tags: [performance]
badges: [patch]
areas: [backend]
---

## What changed

- The politician behavior step reads the autonomy setting and country access once per turn, removing about 170 repeated database reads.
