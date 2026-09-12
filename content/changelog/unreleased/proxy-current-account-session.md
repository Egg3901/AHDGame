---
date: 2026-09-10
title: More consistent session checks before pages and reads load
summary: Page and internal read gating now uses the same current-account session check.
tags: [auth, sessions]
badges: [patch]
areas: [backend]
---

- Page and internal read gating now uses the same current-account session check as sign-in.
- Ordinary pages, public viewing, and offline singleplayer behavior are unchanged; no action needed.
