---
date: 2026-10-15
title: Refounding cooldown starts when a corporation ends
summary: >-
  Players must wait 96 turns after their corporation ends before founding another.
  Admin cleanup and system-owned corporations do not trigger the cooldown.
# Free text. What the change was about: economy, elections, balance, corporations.
tags: []
# How big this change is, which sets how it is grouped in the release post.
# One of: major | minor | patch | hotfix
badges: [patch]
# Which part of the codebase moved. Any of: backend | frontend | fullstack | engine
areas: [backend]
---

## What changed

- The refounding cooldown is now anchored at a player's corporation exit, not its founding.
- The active-corporation limit remains account-wide, and admin force-liquidation is exempt.
- The stock-market Found Corp action shows the remaining turns before refounding is available.
