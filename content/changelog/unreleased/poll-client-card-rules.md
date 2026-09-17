---
date: 2026-09-17
title: Shared Poll client costs
summary: Poll action cards and the poll page display costs from the shared portable Poll rules.
tags: [actions, singleplayer]
badges: [patch]
areas: [engine]
---

- The Commission Poll and Full Demographic Poll action cards read AP cost and base fund cost from the shared portable Poll rules instead of restating 2/6 AP and 25,000/75,000 literals. Existing balance and the display-only unscaled preview are preserved.
- The poll page tier cards render the server-quoted per-tier AP cost instead of hardcoded 2/6 action strings. Drift-sensitive card tests fail if canonical costs move while the cards stay stale.
