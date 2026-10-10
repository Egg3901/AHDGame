---
date: 2026-10-10
title: Restore usable minister actions and complete v2 Cabinet accounts
summary: >-
  Cabinet ministers can perform administrative work even when their department
  has no legislative funding. Offices show usable actions and explain cash,
  charge and cooldown restrictions.
# Free text. What the change was about: economy, elections, balance, corporations.
tags: [cabinet, ministers]
# How big this change is, which sets how it is grouped in the release post.
# One of: major | minor | patch | hotfix
badges: [patch]
# Which part of the codebase moved. Any of: backend | frontend | fullstack | engine
areas: [fullstack]
---

## What changed

- Every v2 ministry has an institutional account and at least two distinct administrative actions that do not require a legislative appropriation.
- The Actions tab and charge counter show the current v2 pool. Unimplemented Programs tabs are hidden, and unavailable action records show an explicit notice.
- Paid actions still require available department cash. Existing balances, obligations and legislative funding are preserved.
