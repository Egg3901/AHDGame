---
date: 2026-10-07
title: 1991 population stocks for eleven more countries
summary: >-
  A 1991 world now builds an age and sex population stock for every populated
  region, including all fourteen Soviet union republics, so population moves by
  births, deaths and migration instead of jumping on the first turn.
tags: [demographics, population, 1991, seed]
badges: [patch]
areas: [engine]
---

## What changed

- 87 regions across the Soviet Union, Poland, Czechoslovakia, Hungary, Romania, Bulgaria, Yugoslavia, Italy, Austria, Finland and Greece now receive a 1991 population stock. They previously had none, so their population never entered the demographic turn.
- Each uses a dated national age shape as an explicit proxy: Eurostat counts for 1 January 1991, or UN population estimates for mid 1991 for the Soviet republics and Yugoslav successor states. Only the adult age split is taken from these sources. Regional population totals stay as seeded, and no other census detail is inferred.
- A world reset now removes every population stock it did not rebuild, so a stock left over from an earlier world can no longer replace a region's seeded population on the first turn.
- A 1991 reset now stops with a clear error if any populated region lacks a dated age shape, instead of starting a world with regions missing from population evolution.
- This does not repair a world that is already running. That needs a separate, reviewed repair.
