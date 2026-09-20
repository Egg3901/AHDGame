---
date: 2026-09-20
title: Faster page loads from projected layout reads and layout-gated status queries
summary: >-
  Pages load faster and the status bar polls cheaper: the root layout reads a
  tiny preset projection instead of the full game state, and the status endpoint
  skips data the current layout never shows.
# Free text. What the change was about: economy, elections, balance, corporations.
tags: [performance, status-bar, layout]
# How big this change is, which sets how it is grouped in the release post.
# One of: major | minor | patch | hotfix
badges: [patch]
# Which part of the codebase moved. Any of: backend | frontend | fullstack | engine
areas: [fullstack]
---

## What changed

- The root layout now reads only the world's reset preset instead of the full
  game state document, cutting that read from tens of kilobytes to a few dozen
  bytes on every page load.
- The status endpoint skips dividends, bonds, union and campaign income, office
  bonuses, corp data and election stats for the minimal layout, which shows none
  of those chips. Other layouts get exactly what they render, and the remaining
  reads run in one parallel batch instead of a sequential chain.
- Status bar refetches for layout changes, trade events and turn changes no
  longer fire while the tab is hidden; the visible-again refresh picks them up
  on return, so background tabs stop polling the status endpoint.
