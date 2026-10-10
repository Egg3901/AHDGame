---
date: 2026-10-10
title: Discord sign-in in the Android app works when your browser takes over
summary: >-
  Signing in with Discord from the Android app no longer ends on a "Session
  expired" page in your phone's browser. The browser now sends you back to the
  app to finish.
tags: [account, client]
# How big this change is, which sets how it is grouped in the release post.
# One of: major | minor | patch | hotfix
badges: [patch]
# Which part of the codebase moved. Any of: backend | frontend | fullstack | engine
areas: [backend]
---

## What changed

- The Android app opens Discord's approval page outside the app so you can use the Discord login you already have. When your phone's browser handled that page instead of the Discord app, sign-in stopped on "Session expired".
- That browser now shows a short "Finish signing in" page and returns you to the app, which completes the sign-in.
