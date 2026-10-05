---
date: 2026-10-05
title: One versioned rules entry point for every player action
summary: >-
  Costs, eligibility and effects for every action now come from a single
  versioned rules module, so the price you see always matches the charge.
tags: [actions, rules]
badges: [patch]
areas: [backend]
---

## What changed

- Every action quote (action points, fund cost, effect and rejection) resolves through one shared rules entry point.
- Action point costs used by the action bar and execution read the same quote. No balance changes.
