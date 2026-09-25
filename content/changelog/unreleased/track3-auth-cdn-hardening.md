---
date: 2026-09-25
title: Harden public API authentication and CDN catalog
summary: >-
  Public API errors now avoid edge caching, and transient usage logging failures
  no longer interrupt API requests. The CDN catalog lists available country art
  more precisely, while singleplayer asset downloads are published safely.
# Free text. What the change was about: economy, elections, balance, corporations.
tags: [api, cdn, authentication, singleplayer]
# How big this change is, which sets how it is grouped in the release post.
# One of: major | minor | patch | hotfix
badges: [patch]
# Which part of the codebase moved. Any of: backend | frontend | fullstack | engine
areas: [backend]
---

## What changed

- Prevented background API key usage writes from crashing the server when MongoDB rejects a write.
- Marked public API authentication and rate limit errors as uncacheable.
- Corrected CDN character image templates and listed the available national action art slugs.
- Added an upstream timeout and atomic cache writes for the singleplayer CDN mirror.
