---
date: 2026-10-04
title: Granular polls account for voter approval and show honest uncertainty
summary: >-
  Granular polls now account for voter approval using the same calculation
  as election tallies. Their displayed uncertainty is clearly described as
  illustrative.
# Free text. What the change was about: economy, elections, balance, corporations.
tags: [elections, polling, approval]
# How big this change is, which sets how it is grouped in the release post.
# One of: major | minor | patch | hotfix
badges: [patch]
# Which part of the codebase moved. Any of: backend | frontend | fullstack | engine
areas: [fullstack]
---

## What changed

- Project candidate approval through the election engine's demographic buckets and apply the same approval and NPP modifiers.
- Explain that the uncertainty bands are illustrative because the projection does not sample respondents.
