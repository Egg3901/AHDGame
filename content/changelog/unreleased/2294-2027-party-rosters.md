---
date: 2026-09-22
title: Correct 2027 political party rosters
summary: >-
  Countries in the 2027 world now open with contemporary political parties
  instead of inheriting dissolved organizations from older historical presets.
# Free text. What the change was about: economy, elections, balance, corporations.
tags: [2027, elections, country-content]
# How big this change is, which sets how it is grouped in the release post.
# One of: major | minor | patch | hotfix
badges: [patch]
# Which part of the codebase moved. Any of: backend | frontend | fullstack | engine
areas: [engine]
---

## What changed

- Adds explicit 2027 opening rosters for twelve countries that previously fell
  back to 1991, 2019, or Soviet-era parties.
- Adds conformance coverage preventing wrong-preset and known obsolete parties
  from entering the 2027 roster.
