---
date: 2026-10-04
title: Safer notifications, image links and data exports
summary: >-
  Notification and image links now check their actual destinations. Poll CSV
  exports preserve embedded quotes, and account login timing is more consistent.
# Free text. What the change was about: economy, elections, balance, corporations.
tags: [security, notifications, polls]
# How big this change is, which sets how it is grouped in the release post.
# One of: major | minor | patch | hotfix
badges: [patch]
# Which part of the codebase moved. Any of: backend | frontend | fullstack | engine
areas: [backend, frontend]
---

## What changed

- Validate notification destinations and image hostnames.
- Protect canvassing and metric maps from unsafe keys.
- Preserve quoted poll labels in CSV exports.
- Use a valid dummy password comparison for unknown accounts.
