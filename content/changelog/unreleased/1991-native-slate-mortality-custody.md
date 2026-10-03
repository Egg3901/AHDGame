---
date: 2026-10-03
title: Preserve native slate financial owners
summary: NPC mortality no longer hands filed Bulgarian or Hungarian mandates to an unfiled generated person.
tags: [1991, bulgaria, hungary, parliament, npc]
badges: [patch]
areas: [backend, engine]
---

## What changed

- Financial NPC actors that represent people on native Bulgarian and Hungarian slates keep their accounts and certified mandates during the NPC mortality pass.
- A randomly generated successor cannot inherit those individual mandates or replace their financial owner without the original slate and succession rules.
- NPCs with ordinary unmarked offices retain their existing mortality, candidacy withdrawal and executive succession behavior.
