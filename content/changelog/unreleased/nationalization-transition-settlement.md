---
date: 2026-10-05
title: Extract funded nationalization settlement
summary: >-
  Funded nationalization settlement now lives in a focused module. Durable Treasury payments and retry behavior remain unchanged.
# Free text. What the change was about: economy, elections, balance, corporations.
tags: [nationalization, treasury]
# How big this change is, which sets how it is grouped in the release post.
# One of: major | minor | patch | hotfix
badges: [patch]
# Which part of the codebase moved. Any of: backend | frontend | fullstack | engine
areas: [backend]
---

## What changed

- Extracted funded shareholder and liquidation settlement from the ownership transition shell.
- Existing quote, payment, and recovery behavior is preserved.
