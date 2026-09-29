---
date: 2026-09-29
title: Add consented game telemetry
summary: >-
  Opted-in game activity and hourly world snapshots now help the team understand
  which features players use and how the game economy changes over time.
tags: [analytics, telemetry]
badges: [patch]
areas: [fullstack]
---

## What changed

- Track major game actions and turn completions after analytics consent.
- Record bounded hourly economy and world events without slowing turn processing.
- Add deployment markers so changes in game activity can be compared with releases.
