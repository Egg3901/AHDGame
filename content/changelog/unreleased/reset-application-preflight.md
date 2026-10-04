---
date: 2026-10-04
title: Validate reset configuration before teardown
summary: >-
  Reset preflight validates the full application configuration and database target
  before teardown. Script connections reject reuse across different database deployments.
# Free text. What the change was about: economy, elections, balance, corporations.
tags: [administration, reliability]
# How big this change is, which sets how it is grouped in the release post.
# One of: major | minor | patch | hotfix
badges: [patch]
# Which part of the codebase moved. Any of: backend | frontend | fullstack | engine
areas: [backend]
---

## What changed

- Validate required application settings before connecting, including target-only checks.
- Reject a database-name mismatch before maintenance, audit or reset writes.
- Bind cached script connections to their URI and discard failed connections before retry.
