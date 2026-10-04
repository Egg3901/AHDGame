---
date: 2026-10-05
title: Avoid negative carry in automatic bank bill purchases
summary: >-
  Automatic bank Treasury sweeps now skip bills whose quoted contract return
  cannot cover current deposit and borrowing costs.
# Free text. What the change was about: economy, elections, balance, corporations.
tags: [banking, treasury]
# How big this change is, which sets how it is grouped in the release post.
# One of: major | minor | patch | hotfix
badges: [patch]
# Which part of the codebase moved. Any of: backend | frontend | fullstack | engine
areas: [backend, engine]
---

## What changed

- Automatic purchases rank positive-carry sovereign bills by annualized
  contract yield and recheck the live quote and funding hurdle before settlement.
- Manual bill choices, charter currency, cash floors, and funded trade receipts
  keep their existing behavior.
