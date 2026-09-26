---
date: 2026-09-26
title: Show player surveys only after login
summary: >-
  In-game surveys now wait until a player is signed in, so visitors on the public homepage do not see them.
tags: [surveys, feedback]
badges: [hotfix]
areas: [frontend]
---

## What changed

- Keep PostHog surveys disabled until the authenticated account ID is identified.
- Disable surveys again when the account session or analytics consent ends.
