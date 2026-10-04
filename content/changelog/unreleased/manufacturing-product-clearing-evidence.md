---
date: 2026-10-04
title: Trace product output through market clearing
summary: >-
  Manufacturing balance evidence now reports product-attributed cash receipts
  from the same market-clearing rule used by the turn engine.
# Free text. What the change was about: economy, elections, balance, corporations.
tags: [products, manufacturing, market]
# How big this change is, which sets how it is grouped in the release post.
# One of: major | minor | patch | hotfix
badges: [patch]
# Which part of the codebase moved. Any of: backend | frontend | fullstack | engine
areas: [engine]
---

## What changed

- The deterministic manufacturing balance report now runs allocated stage output through market clearing at an explicit 80% fill and distinguishes gross product-attributed receipts from the separate capitalized development cash investment. Operating costs remain outside this report.
