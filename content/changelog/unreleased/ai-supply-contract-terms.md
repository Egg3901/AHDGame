---
date: 2026-10-10
title: AI supply contracts now run for a fixed term
summary: >-
  Supply contracts between AI corporations now last 48 turns and then renew against
  current capacity and prices. Contracts signed before this change retire gradually.
tags: [corporations, economy]
# How big this change is, which sets how it is grouped in the release post.
# One of: major | minor | patch | hotfix
badges: [patch]
# Which part of the codebase moved. Any of: backend | frontend | fullstack | engine
areas: [engine]
---

## What changed

- Contracts AI corporations sign with each other run for 48 turns, the same way a player contract with a term does. When one ends, the AI can sign a fresh one at current capacity and prices.
- Contracts you take from an AI corporation's standing listing now come with the same 48-turn term.
- AI-to-AI contracts signed before this change had no end date. They retire gradually over the next few days instead of all at once.
- Turns process faster, because the number of live contracts no longer grows without limit.
