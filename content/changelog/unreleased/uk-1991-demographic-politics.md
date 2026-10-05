---
date: 2026-10-05
title: UK 1991 demographics preserve their historical composition
summary: >-
  UK 1991 starting demographics keep their selected historical composition.
  Social attitudes follow published age, education and income gradients, with
  precise regional lean values in previews.
# Free text. What the change was about: economy, elections, balance, corporations.
tags: [demographics, politics, seeds, UK, "1991"]
# How big this change is, which sets how it is grouped in the release post.
# One of: major | minor | patch | hotfix
badges: [patch]
# Which part of the codebase moved. Any of: backend | frontend | fullstack | engine
areas: [backend, engine]
---

## What changed

- Preserve 1991 demographic shares instead of applying a second historical conversion.
- Use the authored 1991 demographics when the census-derived seed path is disabled.
- Correct age, education and income social attitude inputs using published 1991 survey results.
- Show two-decimal regional averages consistently in position previews and seed output. Shared broad labels can still describe different demographic compositions.
- Restore governing-party platform lookup for NPC electoral mandates.
- Include error codes and support references in remaining regional policy and reset errors.
