---
date: 2026-09-10
title: Add a read-only account session check
summary: >-
  Adds a lightweight way for account integrations to confirm a current game
  session without loading or updating gameplay state.
tags: [accounts]
badges: [patch]
areas: [backend]
---

## What changed

- Added a read-only session endpoint for account integrations.
- Session checks use the current account status and return no staff permissions.
