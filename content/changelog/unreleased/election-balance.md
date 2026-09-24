---
date: 2026-09-24
title: Use current registration in UK elections
summary: >-
  UK elections now use each party's current regional registration instead of
  its starting-era share, removing an unintended advantage for parties created
  after a game begins.
# Free text. What the change was about: economy, elections, balance, corporations.
tags: [elections, balance, uk]
# How big this change is, which sets how it is grouped in the release post.
# One of: major | minor | patch | hotfix
badges: [patch]
# Which part of the codebase moved. Any of: backend | frontend | fullstack | engine
areas: [engine]
---

## What changed

- Changed the UK structural registration baseline to follow current regional
  Reg for every party.
- Kept non-UK elections unchanged and added safe fallbacks for old worlds with
  no current UK registration data.
- Updated election documentation and added a live-snapshot simulation report.
