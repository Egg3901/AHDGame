---
date: 2026-09-10
title: Permanent singleplayer rulers enact laws directly
summary: >-
  Permanent head-of-state characters in singleplayer can now enact validated
  national legislation directly instead of waiting for legislature votes.
tags: [legislation, singleplayer]
badges: [patch]
areas: [fullstack]
---

## What changed

- Recognize decree authority only for the permanent head-of-state character in a local singleplayer world.
- Let that character propose through the existing legislation forms, while retaining normal costs and validation.
- Atomically enact the resulting law and run the same policy effects and enactment hooks as the multiplayer lifecycle.
- Keep every multiplayer and normal singleplayer legislature path unchanged.
- Add a moderator-only diagnostics intake view with 30-day totals and recent redacted reports.
