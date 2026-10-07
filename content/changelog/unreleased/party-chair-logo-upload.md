---
date: 2026-10-07
title: Party chairs can upload a logo again
summary: >-
  Some party chairs were refused when uploading a party logo even though the
  party page showed them as chair. Character creation also no longer leaves a
  stray extra character behind when a step fails partway.
tags: [parties, accounts]
# How big this change is, which sets how it is grouped in the release post.
# One of: major | minor | patch | hotfix
badges: [patch]
# Which part of the codebase moved. Any of: backend | frontend | fullstack | engine
areas: [backend]
---

## What changed

- The party logo upload now checks the character you are playing, the same one
  the party page shows as chair.
- Creating a character reserves your character slot before anything else is
  saved, so a failed or repeated attempt can no longer leave an account with a
  second character it was never allowed.
