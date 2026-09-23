---
date: 2026-09-23
title: Issue the full selected IPO float
summary: >-
  Going public now issues the full selected share amount immediately. Shares enter
  the buyable public float as market cash funds them, and the company receives
  proceeds only for shares placed.
tags: [corporations, equities]
badges: [patch]
areas: [backend]
---

## What changed

- The selected shares are issued immediately, so ownership reflects the full IPO.
- The company view shows how many shares are buyable now and how many await placement.
- Pending placement does not issue the same shares twice or credit the treasury early.
