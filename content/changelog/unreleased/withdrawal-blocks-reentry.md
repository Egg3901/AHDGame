---
date: 2026-10-07
title: Withdrawing from a race now keeps you out of it
summary: >-
  The withdrawal warning always said you could not re-enter a race you left,
  but the game let you file again. It now holds to that.
# Free text. What the change was about: economy, elections, balance, corporations.
tags: [elections]
# How big this change is, which sets how it is grouped in the release post.
# One of: major | minor | patch | hotfix
badges: [patch]
# Which part of the codebase moved. Any of: backend | frontend | fullstack | engine
areas: [fullstack]
---

## What changed

- After you withdraw from an election, the Enter button no longer appears for
  that race and filing again is refused. Re-entering also used to reset your
  support to the starting level.
- Being removed from a race by the game, for example for inactivity or a party
  switch, does not count as a withdrawal and does not block a later entry.
- Hungarian and Bulgarian constituency filings still allow refiling until
  filing closes.
