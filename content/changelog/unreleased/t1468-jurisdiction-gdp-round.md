---
date: 2026-10-10
title: Bill proposals work again
summary: >-
  Proposing a bill through the guided legislative proposal failed with a server
  error for every country after the first turn on 1.14.0. Proposals work again.
tags: [legislation, bugfix]
badges: [hotfix]
areas: [backend]
---

## What changed

- The bill catalog no longer rejects a country's GDP when it is stored with a fractional part. It rounds to whole currency units, which is all the cost estimates need.
