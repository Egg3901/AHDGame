---
date: 2026-10-11
title: Sync chartered party affiliation to held seats
summary: >-
  Charter founders who already hold seats now have the new party affiliation
  shown on those seats while keeping their offices.
# Free text. What the change was about: economy, elections, balance, corporations.
tags: [elections, parties]
# How big this change is, which sets how it is grouped in the release post.
# One of: major | minor | patch | hotfix
badges: [patch]
# Which part of the codebase moved. Any of: backend | frontend | fullstack | engine
areas: [backend]
---

## What changed

- Ratifying a party charter now updates the affiliation on elected-official records for founders who switch parties, matching ordinary party joins without changing their seats.
