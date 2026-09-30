---
date: 2026-09-30
title: Keep reset database selection consistent
summary: Reset commands verify the intended database before changing world data.
tags: [reset, tooling]
badges: [patch]
areas: [backend]
---

- Reset commands and seed helpers now use the same database selection.
- The CLI requires an explicit target assertion and supports a read-only target check.
