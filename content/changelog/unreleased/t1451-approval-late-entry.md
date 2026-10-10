---
date: 2026-10-10
title: Government approval entries follow the current leader
summary: >-
  Government approval contest entries now start when a player leader takes office
  and reset when leadership changes.
tags: [contests, approval]
# How big this change is, which sets how it is grouped in the release post.
# One of: major | minor | patch | hotfix
badges: [patch]
# Which part of the codebase moved. Any of: backend | frontend | fullstack | engine
areas: [engine, frontend]
---

## What changed

- Add player-led governments that form mid-round to the active approval contest.
- Use the approval rating from the current leader's first turn when history has it.
- Reset the country's entry when its leader changes and update English and German rules copy.
