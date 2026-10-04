---
date: 2026-10-05
title: No Google tags in the phone app
summary: >-
  The iPhone and Android app no longer loads Google Analytics or Google Ads
  tags. The website and the desktop client are unchanged.
# Free text. What the change was about: economy, elections, balance, corporations.
tags: [privacy, mobile]
# How big this change is, which sets how it is grouped in the release post.
# One of: major | minor | patch | hotfix
badges: [patch]
# Which part of the codebase moved. Any of: backend | frontend | fullstack | engine
areas: [frontend]
---

## What changed

- Pages opened inside the phone app skip the Google Analytics and Google Ads
  tags. First-party, anonymous page counts still run.
