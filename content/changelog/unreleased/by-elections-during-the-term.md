---
date: 2026-10-02
title: By-elections open for seats vacated mid-term
summary: >-
  Commons seats and governorships vacated mid-term now get a by-election
  instead of sitting empty until the next general election. A seat only waits
  for the general when that election closes before a by-election could.
tags: [elections, uk, by-elections]
badges: [patch]
areas: [engine, frontend]
---

## What changed

- A Commons seat vacated mid-term gets a by-election on the next turn. Before, the general election campaign that runs for the whole term counted as already filling the seat, so no by-election ever opened and vacated seats sat empty for the rest of the term.
- A seat only waits for the general election when the general closes within the 48 turns a by-election would take.
- The same fix applies to governor and First Secretary by-elections.
- The vacancy list says what happens next for each empty seat: a by-election opening next turn, the general election turn that fills it, or the turn the next by-election can open.
- A snap election cancels by-elections still running in the dissolved chamber. Their seats are filled by the snap election.
