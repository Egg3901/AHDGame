---
date: 2026-10-04
title: Add a vehicle operating model under manufacturing
summary: >-
  Manufacturing now has an explicit vehicle operating model that preserves the
  existing automobile recipes during a later, gated taxonomy migration.
tags: [manufacturing, vehicles]
badges: [patch]
areas: [engine]
---

## What changed

- Added a model-aware strategy resolver so vehicle plants keep automobile input
  and output recipes while ordinary manufacturing keeps its own recipe.
- Legacy automobile documents and strategy identifiers remain readable.
