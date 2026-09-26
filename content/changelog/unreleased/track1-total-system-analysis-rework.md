---
date: 2026-09-25
title: Corporation page, Build Org, and wiki link fixes
summary: >-
  Corporation pages now offer a retry when loading fails and link to a wiki
  page only after it is published. Build Org shows the cost of the next build
  and checks the right PS pool before enabling its buttons.
# Free text. What the change was about: economy, elections, balance, corporations.
tags: [corporations, wiki, politics]
# How big this change is, which sets how it is grouped in the release post.
# One of: major | minor | patch | hotfix
badges: [patch]
# Which part of the codebase moved. Any of: backend | frontend | fullstack | engine
areas: [fullstack]
---

## What changed

- Corporation overview pages offer a retry if their data cannot be loaded.
- A corporation's Wiki link appears only when its page is published. CEOs
  can start a draft for the corporation they are viewing.
- Build Org buttons use the current pressure cost and PS pool, including
  increased costs after repeated builds.
