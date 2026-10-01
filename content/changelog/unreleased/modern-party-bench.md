---
date: 2026-10-01
title: Supply the modern default-party candidate bench
summary: Fresh historical 1991 and 2019 worlds give required default parties an unseated NPC actor when their authored roster is empty.
tags: [seeds, parties, npc, 1991, 2019]
badges: [patch]
areas: [engine]
---

## What changed

- Required default parties without human or active NPC members receive one generated, unseated politician with zero funds.
- Home regions prefer authored regional party presence. Retired actors stay retired, and existing party rosters and officials are preserved.
- No Parties player countries, unregistered countries and countries absent from the era are excluded. These actors are a synthetic candidate bench and do not define historical officeholders or election winners.
- Existing worlds, reference refreshes, founding resets and the 1953 and 1979 presets keep their existing actor populations.
