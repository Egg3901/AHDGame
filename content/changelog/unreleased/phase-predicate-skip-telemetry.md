---
date: 2026-10-01
title: Describe filtered turn phases accurately
summary: Turn diagnostics describe eligibility skips without assigning a simulation profile.
tags: [health, diagnostics, turns]
badges: [patch]
areas: [engine]
---

## What changed

- Turn diagnostics record a conditional skip when a phase eligibility predicate rejects execution.
- Ordinary scan cadence and singleplayer exclusions no longer appear as elections-only simulations.
