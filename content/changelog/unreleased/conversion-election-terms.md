---
date: 2026-10-02
title: The first election after a conversion honors its reserved seats
summary: >-
  When a one-party state converts, its first election now keeps the share of
  seats the conversion reserved for the former ruling party, and a forced
  conversion's vote penalty now applies. Both were recorded but never used.
tags: [one-party-state, convention, elections]
badges: [patch]
areas: [engine]
---

## What changed

- The seat share a constitutional convention reserves for the former ruling party now holds in the snap election that follows the conversion. In each region where the party stands a candidate, it gets at least that share of the seats, taken from the largest other holdings.
- A forced conversion (Stage 4 collapse, or a regime change imposed in a peace settlement) reserves 5% of seats (3% if the leader chose to resist the collapse) and cuts the former ruling party's votes by 20% in that first election. Before this change neither applied.
- Only the first election after a conversion is affected. Later elections run as normal.
