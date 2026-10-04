---
date: 2026-10-04
title: Add a vehicle operating model under manufacturing
summary: >-
  Vehicle manufacturing now has an explicit operating model that preserves
  automobile recipes and supports fresh 1991 seeding without rewriting existing
  saves.
tags: [manufacturing, vehicles]
badges: [patch]
areas: [engine]
---

## What changed

- Added a model-aware strategy resolver so vehicle plants keep automobile input
  and output recipes while ordinary manufacturing keeps its own recipe.
- Legacy automobile documents and strategy identifiers remain readable.
- Added model-aware market indexes and an opt-in fresh 1991 reset gate; existing
  populated saves are never converted by routine bootstrap.
