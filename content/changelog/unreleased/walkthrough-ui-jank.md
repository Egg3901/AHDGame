---
date: 2026-09-26
title: Clarify election, banking, market, and game-date displays
summary: >-
  Race entry now asks for confirmation. Election, banking, market, news, and
  notification screens show clearer labels, prices, and game-calendar dates.
# Free text. What the change was about: economy, elections, balance, corporations.
tags: [elections, banking, stock-market, game-calendar]
# How big this change is, which sets how it is grouped in the release post.
# One of: major | minor | patch | hotfix
badges: [patch]
# Which part of the codebase moved. Any of: backend | frontend | fullstack | engine
areas: [frontend]
---

## What changed

- Confirm race entry before filing and show failures when election actions are rejected.
- Correct misleading primary close badges and duplicate deadline labels.
- Align the stock ticker with the normalized price used by the stocks table.
- Show game-calendar months for central-bank appointments, news, and notifications.
- Remove an internal bank ID from the admin picker and let bank details wrap.
- Round favorability and explain the game's shared accounting unit.
