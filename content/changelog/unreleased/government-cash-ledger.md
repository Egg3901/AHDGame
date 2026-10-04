---
date: 2026-10-04
title: Track funded Treasury cash separately from fiscal position
summary: >-
  A gated ledger separates spendable Treasury cash backed by funded bond-pool
  proceeds from the signed fiscal position used for historical accounting.
# Free text. What the change was about: economy, elections, balance, corporations.
tags: [economy, banking]
# How big this change is, which sets how it is grouped in the release post.
# One of: major | minor | patch | hotfix
badges: [patch]
# Which part of the codebase moved. Any of: backend | frontend | fullstack | engine
areas: [backend, engine]
---

## What changed

- A disabled-by-default cash ledger records actual pool-funded sovereign
  proceeds separately from the signed fiscal position. Modelled macro revenue
  remains analytical and does not create spendable cash.
- Funded bank claims, reserve transfers, and fiscal rescue actions use the
  same cash stock when the ledger is enabled, preventing pool proceeds from
  being spent twice.
