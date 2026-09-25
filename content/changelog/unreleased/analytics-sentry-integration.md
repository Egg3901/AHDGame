---
date: 2026-09-25
title: Consent-based analytics and Sentry reporting
summary: >-
  With your permission, we can see where players get stuck during onboarding
  and find game errors faster.
# Free text. What the change was about: economy, elections, balance, corporations.
tags: [analytics, observability]
# How big this change is, which sets how it is grouped in the release post.
# One of: major | minor | patch | hotfix
badges: [patch]
# Which part of the codebase moved. Any of: backend | frontend | fullstack | engine
areas: [fullstack]
---

## What changed

- Optional analytics records selected onboarding and game milestones after you accept analytics cookies.
- Error reports now reach our Sentry project, helping us identify and fix crashes.
