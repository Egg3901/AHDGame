---
date: 2026-09-15
title: Guided chat mode for character creation
summary: >-
  Character creation has an opt-in guided chat mode that walks through the same
  steps one at a time. The classic all-steps form stays the default.
# Free text. What the change was about: economy, elections, balance, corporations.
tags: [character creation, onboarding]
# How big this change is, which sets how it is grouped in the release post.
# One of: major | minor | patch | hotfix
badges: [minor]
# Which part of the codebase moved. Any of: backend | frontend | fullstack | engine
areas: [frontend]
---

## What changed

- New opt-in guided chat on `/create-character` ("Try guided chat", persisted): one canonical step at a time in canonical order with a transcript, direct edit, Back, and gated Continue.
- Same panels, same validation, same submit payload; imperial creation untouched.
