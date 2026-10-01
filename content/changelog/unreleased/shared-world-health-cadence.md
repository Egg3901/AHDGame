---
date: 2026-10-01
title: Record shared-world health every turn
summary: Shared worlds retain a health snapshot for every turn.
tags: [health, diagnostics, turns]
badges: [patch]
areas: [engine]
---

## What changed

- Shared-world health snapshots run every turn instead of following the anti-abuse scan schedule.
- The three abuse scans keep their existing cadence, and singleplayer keeps its local diagnostic behavior.
