---
date: 2026-10-03
title: No failing requests on the front page for signed-out visitors
summary: >-
  The navbar no longer asks for character status before anyone has signed
  in, and leader cards no longer request portraits that do not exist.
tags: [navbar, performance]
badges: [patch]
areas: [frontend]
---

## What changed

- Visitors who are not signed in no longer send the navbar's character status request, which could only fail. Singleplayer is unchanged.
- Front page leader cards without a portrait no longer request one that does not exist, so the page logs no failed image loads.
