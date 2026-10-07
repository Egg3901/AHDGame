---
date: 2026-10-07
title: Unfunded state capex grants no longer stall the corporation turn
summary: >-
  A state enterprise's replacement capex grant is now paid only from spendable
  Treasury cash. A country that cannot cover it skips the grant for that turn
  instead of stopping corporation processing for everyone.
# Free text. What the change was about: economy, elections, balance, corporations.
tags: [economy, corporations, nationalization, treasury]
# How big this change is, which sets how it is grouped in the release post.
# One of: major | minor | patch | hotfix
badges: [hotfix]
# Which part of the codebase moved. Any of: backend | frontend | fullstack | engine
areas: [engine]
---

## What changed

- A state capex grant that the owning Treasury cannot fully cover from spendable cash is skipped for that turn. The enterprise receives no replacement capacity and the Treasury is not charged.
- Corporation processing continues past an unfunded grant, so other countries' grants, loss backing, remittance, taxes, salaries, dividends and history are no longer held up.
- A funded grant charges the Treasury and installs the replacement capacity together, and a retried turn does not charge or build twice.
