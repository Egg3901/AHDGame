---
date: 2026-10-12
title: Restrict UK PM devolution dashboard access
summary: >-
  The UK PM office's Devolution dashboard is now visible only to the sitting
  Prime Minister and admins, including when opened through a direct link.
# Free text. What the change was about: economy, elections, balance, corporations.
tags: [government, devolution]
# How big this change is, which sets how it is grouped in the release post.
# One of: major | minor | patch | hotfix
badges: [patch]
# Which part of the codebase moved. Any of: backend | frontend | fullstack | engine
areas: [fullstack]
---

## What changed

- Restrict both the dashboard tab and its data endpoint to the sitting UK PM or an admin.
- Keep stance changes restricted to the sitting PM; admin viewing does not grant editing authority.
- Cover denied direct links, unauthorized data requests, admins without characters, and lost PM authority.
