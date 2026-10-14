---
date: 2026-10-14
title: "NPP engine 6.11: the opposition picks its battles"
summary: At autonomy v6, the opposition's bloc vote against government bills applies only while the government side holds under 55% of the lower chamber; against a commanding government opposition NPPs vote on the merits.
tags: [npp, legislation, autonomy]
badges: [minor]
areas: [backend, engine]
---

## What changed

- At autonomy v6, autonomous bill voting applies the v1 opposition bloc force only when the government side (governing party plus `coalitionPartyIds`) holds less than 55% of the live lower-chamber tally. At or above 55%, no opposition force is applied, and opposition NPPs vote on ideology, district and donors.
- The 6.5 sponsor vote count applies the same rule, so projection and voting agree. Government directives now carry `coalitionPartyIds`.
- NPP engine version 6.11.0, recorded in the [NPP changelog](/changelog/npp).

## Scope

Worlds below autonomy v6 are unchanged. Production runs v4.
