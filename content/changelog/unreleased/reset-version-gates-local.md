---
date: 2026-09-29
title: Stage reset system version gates
summary: >-
  The admin panel now shows separate version controls for metrics, legislation,
  and Cabinet. Current gameplay stays on v1 while the reset versions are built.
# Free text. What the change was about: economy, elections, balance, corporations.
tags: [reset, feature-gates]
# How big this change is, which sets how it is grouped in the release post.
# One of: major | minor | patch | hotfix
badges: [patch]
# Which part of the codebase moved. Any of: backend | frontend | fullstack | engine
areas: [fullstack]
---

## What changed

- Added independent v1/v2 controls with v1 as the default for existing and fresh worlds.
- Kept v2 disabled until each replacement system is fully implemented and verified.
- Included the proposed Guided Path modal in the legislation version contract.
