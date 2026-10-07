---
date: 2026-10-07
title: A timed-out turn step finishes before the turn moves on
summary: >-
  When a turn step ran past its time limit, the turn recorded it as failed and
  carried on while that step was still writing in the background, so later
  steps could run against half-finished results. The turn now waits for the
  slow step to stop before anything else runs.
tags: [turns, stability]
badges: [hotfix]
areas: [backend, engine]
---

## What changed

- A step that passes its time limit is still reported as failed right away.
- No later step starts, and the turn does not finish, until the slow step has
  actually stopped. The turn keeps its lock while it waits.
- A step that never stops now holds the turn rather than letting the next one
  run over it.
