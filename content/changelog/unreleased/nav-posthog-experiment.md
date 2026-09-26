---
date: 2026-09-26
title: A/B test a compact mobile navigation
summary: >-
  A compact mobile navigation is ready for testing. In the new layout, profile
  links open from the avatar while game sections stay easy to reach.
# Free text. What the change was about: economy, elections, balance, corporations.
tags: [navigation, experiment]
# How big this change is, which sets how it is grouped in the release post.
# One of: major | minor | patch | hotfix
badges: [patch]
# Which part of the codebase moved. Any of: backend | frontend | fullstack | engine
areas: [frontend]
---

## What changed

- Added a PostHog experiment that keeps the current navigation as the control.
- Added a compact mobile section grid and a separate avatar menu for profile actions.
