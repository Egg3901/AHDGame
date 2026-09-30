---
date: 2026-09-29
title: Restore autocomplete and add a search results page
summary: >-
  Search suggestions return when the navigation search opens, and Enter now
  opens a full results page with matches across the game.
# Free text. What the change was about: economy, elections, balance, corporations.
tags: [navigation, search]
# How big this change is, which sets how it is grouped in the release post.
# One of: major | minor | patch | hotfix
badges: [patch]
# Which part of the codebase moved. Any of: backend | frontend | fullstack | engine
areas: [frontend]
---

## What changed

- Restored the focused search suggestions and kept autocomplete available while typing.
- Kept autocomplete visible inside the experimental mobile drawer.
- Added `/search` with localized, themed results, plus Enter-to-search behavior from the navigation.
