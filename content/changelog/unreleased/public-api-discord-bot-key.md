---
date: 2026-10-08
title: Discord bot can read the public API
summary: >-
  The public API now accepts the Discord bot's own key, so the bot's country,
  commodity, war and legislation commands can load their data.
tags: [api, discord]
badges: [minor]
areas: [backend]
---

## What changed

- `/api/public/v1` accepts the Discord bot's key as well as the public bot key.
  The bot's country, commodity, war and legislation commands use these routes.
