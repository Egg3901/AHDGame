---
date: 2026-10-07
title: Restore observed turn completion analytics
summary: >-
  Turn notifications now include the observed turn number so consented analytics
  can record a completed turn when a signed-in player has the game open.
tags: [analytics]
badges: [patch]
areas: [frontend]
---

## What changed

- Include the observed turn number in shared turn events instead of an empty payload.
- Verify the real tracker records a turn advance once, skips initial and unchanged status, and stays inactive without analytics consent.
