---
date: 2026-10-06
title: Show regional registration pools for new parties
summary: >-
  Regional overviews now show existing registration pools even when new parties
  have no registered voters. Independent and Unregistered shares no longer
  disappear when the leading party has no stored registration value.
# Free text. What the change was about: economy, elections, balance, corporations.
tags: [elections, registration, regions]
# How big this change is, which sets how it is grouped in the release post.
# One of: major | minor | patch | hotfix
badges: [patch]
# Which part of the codebase moved. Any of: backend | frontend | fullstack | engine
areas: [backend]
---

## What changed

- Determine registration chart availability from the region's registration pool,
  independently of the leading party's registration field.
- Preserve the unseeded placeholder when the regional pool is genuinely absent.
- Cover new parties, empty party rosters, and US, UK, and Japan regional data with
  regression tests. No registration shares or election rules change.
