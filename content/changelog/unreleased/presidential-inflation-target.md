---
date: 2026-10-04
title: Presidential inflation voting follows the country and era target
summary: >-
  Presidential voters judge inflation against their country's target for the
  selected era. Historical worlds no longer penalize a government for meeting
  a higher inflation target.
# Free text. What the change was about: economy, elections, balance, corporations.
tags: [elections, economy, balance]
# How big this change is, which sets how it is grouped in the release post.
# One of: major | minor | patch | hotfix
badges: [patch]
# Which part of the codebase moved. Any of: backend | frontend | fullstack | engine
areas: [engine]
---

## What changed

- Center the inflation tolerance band on the country and era target while retaining the existing penalty slope and cap.
- Preserve the established fallback when an inflation target is unavailable.
