---
date: 2026-10-04
title: Patched file-pattern parsing
summary: >-
  Patch a vulnerable file-pattern dependency while preserving its compatible
  dependency versions.
# Free text. What the change was about: economy, elections, balance, corporations.
tags: [security, dependencies]
# How big this change is, which sets how it is grouped in the release post.
# One of: major | minor | patch | hotfix
badges: [patch]
# Which part of the codebase moved. Any of: backend | frontend | fullstack | engine
areas: [backend]
---

## What changed

- Update the pinned `brace-expansion` 1.x dependency to `1.1.21` and require at least `5.0.12` for the existing 5.x dependency line.
- Bound repeated parser restarts on malformed brace patterns. Ordinary brace expansion and file matching remain compatible.
