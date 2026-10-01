---
date: 2026-10-01
title: Anti-abuse checks no longer delay turns
summary: >-
  Fraud and alt-account checks run right after each turn finishes instead of during it.
tags: [performance]
badges: [patch]
areas: [backend]
---

## What changed

- The financial, audit and alt-account checks run immediately after the turn completes, on the same schedule as before, so every third turn finishes sooner.
