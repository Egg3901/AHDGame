---
date: 2026-09-25
title: Improve legislature webhook updates and profile pictures
summary: >-
  US legislature webhook updates now include Capitol artwork and vote charts.
  Broken profile pictures fall back to the character's initial.
# Free text. What the change was about: economy, elections, balance, corporations.
tags: [legislature, discord, profile-pictures]
# How big this change is, which sets how it is grouped in the release post.
# One of: major | minor | patch | hotfix
badges: [patch]
# Which part of the codebase moved. Any of: backend | frontend | fullstack | engine
areas: [fullstack]
---

## What changed

- Added Capitol artwork and floor vote charts to US bill enactment and veto
  webhook posts. Other country event cards identify legislative updates by
  legislature.
- Avatar images load directly from their stored URL and show the character's
  initial if the image cannot load.
