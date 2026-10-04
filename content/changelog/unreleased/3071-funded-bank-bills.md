---
date: 2026-10-04
title: Funded sovereign bills in bank treasuries
summary: >-
  Banks can hold short sovereign bills against funded market inventory, with
  manual trades or an optional cash sweep above their reserve floor.
# Free text. What the change was about: economy, elections, balance, corporations.
tags: [economy, banking]
# How big this change is, which sets how it is grouped in the release post.
# One of: major | minor | patch | hotfix
badges: [minor]
# Which part of the codebase moved. Any of: backend | frontend | fullstack | engine
areas: [backend, frontend, engine]
---

## What changed

- CEOs can buy or sell same-currency sovereign bills with up to 48 turns to
  maturity. Purchases use bank vault cash above required reserves, a household
  withdrawal buffer, and due interest. Sales require cash in the bond market
  pool.
- The optional automatic sweep buys bills from actual public float, nearest
  maturity first. Holdings are marked at the current executable pool bid and
  count toward bank equity and capital, but not toward cash reserves.
- Failed-bank resolution sells only the units the pool can fund before the
  depositor waterfall closes. This feature is disabled by default.
