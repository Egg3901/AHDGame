---
date: 2026-10-04
title: Decided monetary committee votes resolve without waiting for no-shows
summary: >-
  Monetary committee votes resolve once the remaining ballots cannot change
  the outcome. Player no-shows no longer delay a decided rate change for half
  a game year.
# Free text. What the change was about: economy, elections, balance, corporations.
tags: [economy, monetary-policy, voting]
# How big this change is, which sets how it is grouped in the release post.
# One of: major | minor | patch | hotfix
badges: [patch]
# Which part of the codebase moved. Any of: backend | frontend | fullstack | engine
areas: [engine]
---

## What changed

- Decided motions resolve from the next turn, restoring the scheduled eight-turn meeting cadence for boards with a settled majority.
- Undecided motions retain their full voting window. The strict board majority, rate-change limits and opening-turn protection continue to apply.
