---
date: 2026-10-13
title: "NPP engine 6.8: NPP business stakes shape their votes"
summary: At autonomy v6, an NPP that runs or holds at least 1% of a company leans for subsidies and sector tariffs in that company's sectors and against ending them or nationalising its company, capped below a hard whip.
tags: [npp, legislation, corporations, autonomy]
badges: [minor]
areas: [backend, engine]
---

## What changed

- At autonomy v6, autonomous NPP bill voting adds a business-interest term to the donors force for bills carrying `subsidy`, `end_subsidy`, `tariff` or `nationalize` provisions.
- Stakes: CEO of a company (weight 1) or holder of at least 1% of its shares (weight 0.5), spread to the company's sector types, both raw and operating type.
- Effects:
  - sector subsidy: +stake;
  - economy-wide subsidy: +half;
  - ending a sector subsidy: -stake;
  - sector tariff: +stake;
  - tariff aimed at the holder's company: -stake;
  - nationalisation of the company or sector: -stake.
- The sum is times 40 and capped at ±40, which is below the hard-whip base of 60.
- Stakes are read in two batched queries per voting pass (corporations by CEO or NPP shareholder, then their sectors), and only when a bill in a v6 country carries one of those provisions.
- NPP engine version 6.8.0, recorded in the [NPP changelog](/changelog/npp).

## Scope

Worlds below autonomy v6 are unchanged. Production runs v4.
