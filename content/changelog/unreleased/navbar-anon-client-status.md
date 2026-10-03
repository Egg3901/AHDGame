---
date: 2026-10-03
title: No character status request for signed-out visitors
summary: >-
  The navbar no longer asks for character status before anyone has signed in.
tags: [navbar, performance]
badges: [patch]
areas: [frontend]
---

## What changed

- Visitors who are not signed in no longer send the navbar's character status request, which could only fail. Singleplayer is unchanged.
