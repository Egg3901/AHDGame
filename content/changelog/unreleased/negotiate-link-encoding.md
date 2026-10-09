---
date: 2026-10-08
title: Safer negotiate links on supply offers
summary: >-
  The Negotiate link on a supply offer now always opens the chosen
  corporation's page.
tags: [market, security]
badges: [patch]
areas: [frontend]
---

## What changed

- The Negotiate button on a supply offer builds its link from the corporation you picked. That part of the link is now encoded, so it always points at that corporation's page.
