---
date: 2026-10-08
title: Show corporation cash arrears in Financials
summary: >-
  CEOs can see arrears paid last turn and arrears remaining in Financials,
  explaining why positive income may not increase available cash.
# Free text. What the change was about: economy, elections, balance, corporations.
tags: [corporations, financials]
# How big this change is, which sets how it is grouped in the release post.
# One of: major | minor | patch | hotfix
badges: [patch]
# Which part of the codebase moved. Any of: backend | frontend | fullstack | engine
areas: [fullstack]
---

## What changed

- Add a CEO-only Cash arrears section covering operating and federal tax arrears.
- Read completed payments from existing settlement receipts; no repayment rules change.
- Keep arrears amounts independent of the selected income-statement period.
