---
date: 2026-10-01
title: Recognize NPC party membership in health checks
summary: Active NPC members prevent false empty-party warnings after a player joins.
tags: [health, parties, npc]
badges: [patch]
areas: [engine]
---

## What changed

- Party health recognizes active NPC affiliations within the same country.
- Retired NPCs and members of a different country's party do not hide genuinely empty parties.
- Human membership counts and party rosters are preserved.

Empty-party diagnostics also run in worlds without human characters; active NPC membership removes false warnings while retired, foreign and missing affiliations remain visible.
