---
date: 2026-09-25
title: API key introspection endpoint
summary: >-
  Integration clients can now call GET /api/v1/key with their X-API-Key to
  verify the key's scope, allowed operations, and usage metadata without
  exposing the secret.
# Free text. What the change was about: economy, elections, balance, corporations.
tags: [api]
# How big this change is, which sets how it is grouped in the release post.
# One of: major | minor | patch | hotfix
badges: [minor]
# Which part of the codebase moved. Any of: backend | frontend | fullstack | engine
areas: [backend]
---

## What changed

- Added `GET /api/v1/key`, a read-only introspection endpoint: a caller sends
  its own `X-API-Key` and gets back the key's scope (`public` or `private`),
  allowed operation classes, name, prefix, and usage counters. The response is
  `no-store` and never contains the token or its hash.
- `/api/public/v1/meta` now lists the introspection endpoint, and the API
  automation guide documents it.
