---
date: 2026-09-28
title: Preserve distinct crisis participants and opening requirements
summary: >-
  Crisis substitutions no longer assign different historical actors to the same
  country. New crises wait until their required belligerents are available, and
  modern crisis decision windows open on phase entry and their recurring cadence.
tags: [crises, diplomacy]
badges: [patch]
areas: [engine]
---

## What changed

- Preserve existing belligerents and backers before assigning authored fallbacks.
- Include active background countries when resolving crisis participants, excluding retired ones.
- Prevent different missing actors from claiming the same substitute country.
- Keep new crises dormant when belligerent slots are missing, while preserving
  already-running conflicts and allowing a later opening when participants appear.
- Restore decision windows that should fire on phase entry and recur later, while
  preserving campaign-stage and intensity restrictions.
