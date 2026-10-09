---
date: 2026-10-09
title: Iteration referrals count from the iteration start
summary: >-
  The iteration referral leaderboard now counts from the day the current
  iteration began, using the same rules as the weekly referral contest.
# Free text. What the change was about: economy, elections, balance, corporations.
tags: [contests, referrals]
# How big this change is, which sets how it is grouped in the release post.
# One of: major | minor | patch | hotfix
badges: [patch]
# Which part of the codebase moved. Any of: backend | frontend | fullstack | engine
areas: [backend]
---

## What changed

- The iteration referral leaderboard counts players you invited who created a character since the iteration started, not since an older date.
- Accounts strongly linked to the referrer as alts, and banned accounts, do not count, the same as the weekly referral contest.
- Players invited between a reset and the first turn of the new iteration now count toward the new iteration.
