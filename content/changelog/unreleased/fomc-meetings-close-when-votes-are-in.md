---
date: 2026-10-10
title: Rate committees decide as soon as every vote is in
summary: >-
  A central bank committee with no player members now settles its meeting on the
  next turn instead of waiting out the full voting window.
tags: [economy, central-banks]
# How big this change is, which sets how it is grouped in the release post.
# One of: major | minor | patch | hotfix
badges: [patch]
# Which part of the codebase moved. Any of: backend | frontend | fullstack | engine
areas: [engine]
---

## What changed

- A rate meeting now closes as soon as no seated player still has a vote to cast. Committees made up only of AI members settle on the turn after the meeting opens.
- The voting window still applies whenever a player holds a seat and has not voted yet.
- Previously an AI-only committee waited the full 24-turn window on every meeting, so its rate could sit unchanged while inflation moved a long way. Meetings now follow the regular 8-turn cadence.
