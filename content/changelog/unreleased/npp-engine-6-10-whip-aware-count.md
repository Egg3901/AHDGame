---
date: 2026-10-13
title: "NPP engine 6.10: sponsor vote counts include the government whip"
summary: At autonomy v6, the NPP sponsor's pre-filing vote count applies the 6.7 government soft whip to the governing party's members on goal bills, matching how those bills are voted.
tags: [npp, legislation, autonomy]
badges: [minor]
areas: [backend, engine]
---

## What changed

- At autonomy v6, `projectChamberVote` takes the government's soft-whip context (`nppGovernmentWhipFor`, the same gating as 6.7: NPP-led government, no player chair or vice-chair, active goal domain).
- For governing-party members on a goal bill, the count uses the soft whip in place of the party-line lean, exactly as 6.7 voting does.
- Government directives now report whether the head of government is an NPP.
- NPP engine version 6.10.0, recorded in the [NPP changelog](/changelog/npp).

## Scope

Worlds below autonomy v6 are unchanged. Production runs v4.
