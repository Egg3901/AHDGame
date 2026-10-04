---
date: 2026-10-03
title: Blocs can declare war together
summary: >-
  A Bloc can vote to start a war against a player nation. Every player nation
  in the Bloc must consent, NPP-governed members join automatically, and each
  other eligible player nation then votes on its own declaration in its
  legislature.
tags: [war, diplomacy, intorg]
badges: [minor]
areas: [fullstack, engine]
---

## What changed

- Bloc organizations, including player-founded Blocs, can pass a declare war resolution. A member country proposes it from the Collective declaration of war panel on the organization's Overview tab, choosing a target country and a war goal.
- The target must be a player-enabled country outside the Bloc, and conflicts must be enabled. A Bloc cannot declare war on its own member, and it holds one pending declaration per target.
- Voting lasts 24 turns. Only player nations in the Bloc hold ballots, foreign ministers cast them, and every one must vote yes. Abstaining or not voting counts as a no.
- When the resolution passes, NPP-governed members join the war automatically as one coalition. Each other eligible player nation receives its own declaration of war in its legislature, with every voting chamber open at the same time for 24 turns. Each declaration still needs a two-thirds vote in every required chamber.
- A member is skipped if it shares a Bloc with the target, has a truce with it, is already at war with it, or is a player nation that declared war within the last 120 turns.
- A country whose legislature refuses stays out of the war. The NPP members and every country that ratifies stay in.
- The Declaring War and International Organizations wiki pages describe the rule.

Pull request: [#2975](https://github.com/Egg3901/AHDGame/pull/2975).
