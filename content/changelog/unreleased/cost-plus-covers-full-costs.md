---
date: 2026-10-13
title: Cost-plus pricing covers every operating cost
summary: >-
  Plants on cost-plus pricing now quote enough to cover all of their running
  costs, so a plant that sells its whole output earns its markup instead of a
  loss.
# Free text. What the change was about: economy, elections, balance, corporations.
tags: [economy, corporations]
# How big this change is, which sets how it is grouped in the release post.
# One of: major | minor | patch | hotfix
badges: [patch]
# Which part of the codebase moved. Any of: backend | frontend | fullstack | engine
areas: [engine]
---

## What changed

- Cost-plus quotes now include disaster losses and policy charges, which were billed to the plant but left out of the price.
- Cost-plus quotes now follow input prices as far as the input bill does. Before, a plant whose inputs were very expensive was quoted below its actual material cost.
- A plant that sells everything at zero markup now breaks even, and any positive markup is profit.
