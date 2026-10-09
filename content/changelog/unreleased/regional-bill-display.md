---
date: 2026-10-08
title: Regional bill provisions and display
summary: >-
  Regional bills now share the national provisions display and desktop layout.
  Outdated reviewed-law forms are rejected instead of silently losing provisions.
# Free text. What the change was about: economy, elections, balance, corporations.
tags: [legislation]
# How big this change is, which sets how it is grouped in the release post.
# One of: major | minor | patch | hotfix
badges: [patch]
# Which part of the codebase moved. Any of: backend | frontend | fullstack | engine
areas: [fullstack]
---

## What changed

- Share provision cards and an explicit empty-provisions message across national and regional bills.
- Place regional progress beside voting on desktop while preserving regional assent and override controls.
- Reject reviewed-law submissions when the reviewed legislation system is unavailable, before charging the proposer or saving an empty bill.
