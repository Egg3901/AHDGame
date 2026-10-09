---
date: 2026-10-09
title: Restore exchange selection and retire legacy stock market page
summary: >-
  The Market restores exchange selection and exchange size comparisons, and
  old stock-market page links now open the matching view in the hub.
# Free text. What the change was about: economy, elections, balance, corporations.
tags: [market, exchanges, navigation]
# How big this change is, which sets how it is grouped in the release post.
# One of: major | minor | patch | hotfix
badges: [patch]
# Which part of the codebase moved. Any of: backend | frontend | fullstack | engine
areas: [frontend]
---

## What changed

- The market chart and stock list can be scoped to a country exchange. The Compare
  panel shows listing counts and market capitalization for enabled exchanges.
- Country stock-market routes now redirect to the matching exchange in The
  Market. Existing links keep their selected tab where the hub has an equivalent.
