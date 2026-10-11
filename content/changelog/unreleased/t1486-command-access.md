---
date: 2026-10-11
title: Defense administration while conflicts are disabled
summary: >-
  Defense ministers and authorized admins can manage personnel, commands, and unit assignments while Conflicts is disabled. Naval and air state remains viewable, but mission orders stay unavailable.
# Free text. What the change was about: economy, elections, balance, corporations.
tags: [military, conflicts]
# How big this change is, which sets how it is grouped in the release post.
# One of: major | minor | patch | hotfix
badges: [patch]
# Which part of the codebase moved. Any of: backend | frontend | fullstack | engine
areas: [backend, frontend]
---

## What changed

- Keep command administration available independently of the Conflicts flag while preserving defense-holder and admin authorization.
- Show naval and air state with a clear read-only notice when Conflicts is disabled.
