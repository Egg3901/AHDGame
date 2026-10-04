---
date: 2026-10-02
title: Merged parties leave regional party lists
summary: >-
  A party that merged away no longer appears in region and state party
  organization lists or takes part in registration. A repair clears the leftover
  rows in older worlds and returns their registration share to the unregistered
  pool.
tags: [parties, mergers]
badges: [patch]
areas: [fullstack, backend]
---

## What changed

- The region page, the state overview and the registration ledger list only active parties. A party absorbed by a merger no longer shows an organization or registration figure.
- In worlds where a merger completed before the merge cleanup shipped, the absorbed party's regional rows were left behind. They stayed visible in the organization and registration lists and kept taking part in registration drift.
- A one-time repair deletes those rows and sets each state's unregistered pool from the registration that active parties actually hold, so a retry gives the same result.

Pull request: [#2881](https://github.com/Egg3901/AHDGame/pull/2881).
