---
date: 2026-09-17
title: Shared Build Donor Network rules
summary: Build Donor Network action costs and level gain share a portable rules module.
tags: [actions, singleplayer]
badges: [patch]
areas: [engine]
---

- Build Donor Network quotes and effects use the same portable cost, AP-tier and level-gain rules. Existing balance, level scaling, GDP scaling and stat multipliers are preserved.
- Build Donor Network validation rejects unallocated stats and missing home-state economics with the quoted reason instead of substituting neutral values.
