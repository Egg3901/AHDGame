---
date: 2026-09-10
title: Conserve duplicate shares in account cleanup
summary: >-
  Account cleanup now returns every share an exiting holder owns to the public
  float, including split positions, and retries safely when the ledger changes
  mid-cleanup.
# Free text. What the change was about: economy, elections, balance, corporations.
tags: [corporations, shares, cleanup]
# How big this change is, which sets how it is grouped in the release post.
# One of: major | minor | patch | hotfix
badges: [patch]
# Which part of the codebase moved. Any of: backend | frontend | fullstack | engine
areas: [backend]
---

## What changed

- Exiting characters and corporations return the full sum of each issuer
  position to the public float, including split positions for the same holder.
- Cleanup detects when an issuer ledger changes mid-cleanup, rereads it, and
  retries within a bounded budget instead of crediting a stale total.
