---
date: 2026-09-17
title: Shared Personal Donation card cost
summary: The Personal Campaign Donation action card reads its AP cost from the shared portable ConvertCash rules.
tags: [actions, singleplayer]
badges: [patch]
areas: [engine]
---

- The Personal Campaign Donation action card reads its flat AP cost from the shared portable ConvertCash rules instead of restating the 2 AP literal. Existing balance is preserved.
- The campaign, advertise and build-donor-base card literals stay as they are: those costs are state-dependent (influence/favorability/donor-level tiers) and the actions page already shadows them with page-level canonical quotes, so there is no single flat const the module-level literals could track. Drift-sensitive card tests fail if the canonical ConvertCash cost moves while the card stays stale.
