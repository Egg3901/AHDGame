---
date: 2026-09-08
title: Staff can grant temporary singleplayer access from Discord
summary: >-
  /temp-sp-access on the Discord bot gives a tagged, Discord-linked account
  time-limited official client access (30 days by default) without a permanent
  entitlement.
tags: [client, discord, access]
# How big this change is, which sets how it is grouped in the release post.
# One of: major | minor | patch | hotfix
badges: [minor]
# Which part of the codebase moved. Any of: backend | frontend | fullstack | engine
areas: [backend]
---

## What changed

- A Discord-linked account can receive time-limited singleplayer access. The
  desktop client honours the cutoff; the offline cache cannot run past it.
- Permanent admin grants and active Supporter+/++ access are unchanged.
