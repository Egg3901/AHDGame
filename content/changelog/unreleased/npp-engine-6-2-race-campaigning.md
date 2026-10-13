---
date: 2026-10-13
title: "NPP engine 6.2: NPP candidates rally their own race"
summary: At autonomy v6, a running NPP's first campaign action each cycle becomes a rally in its race, at the same cost and with the same Support effect as a player rally, instead of a general influence gain.
tags: [npp, elections, campaigns, autonomy]
badges: [minor]
areas: [backend, engine]
---

## What changed

- At autonomy v6, when an NPP is an active candidate in a race where players can hold rallies, the first campaign action of its four-turn cycle is a rally in that race.
- The rally costs the campaign action's existing action points and funds and replaces that action's political influence gain.
- It moves the candidate's Support exactly as a player rally in that race family does: the full value is 10 times the race-family scale, 60% applied at once and 40% over four turns. Support decays toward 50 as before.
- An NPP rallies at most once per cycle (players can rally once a turn), and never twice on the same turn.
- The NPP action signals now carry the NPP's own race: the candidate row, the race type, whether it is rally-eligible, its Support, and its last rally turn. These come from the same two queries as before, with wider projections.
- Turn results report `rallies`.
- NPP engine version 6.2.0, recorded in the [NPP changelog](/changelog/npp).

## Scope

Worlds below autonomy v6 are unchanged. Production runs v4.
