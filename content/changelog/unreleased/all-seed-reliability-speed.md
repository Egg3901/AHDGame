---
date: 2026-09-10
title: Every historical world starts complete and turns faster
summary: >-
  Every era-valid country now runs in player, expanded-economy, or NPP-only mode
  across every world seed, incomplete party and budget eras inherit complete
  data, founding elections fail closed, and index funds batch their bond reads.
tags: [worlds, seeds, elections, npp, performance]
badges: [minor]
areas: [engine]
---

## Fixed

- The 2019 and 2023 seeds now materialize every fully seeded sovereign country's
  access instead of leaving most frozen in coming-soon state. Historical and
  dissolved entities remain out of later-era simulations.
- Later-era country packs no longer boot without political parties. When a new
  roster has not been authored yet, the seed inherits that country's nearest
  earlier complete roster.
- Later-era budget bundles retain fully seeded countries from the prior era,
  and every enabled economy has a stable sovereign issuer corporation.
- The 1979 seed now starts its founding-election phase automatically, matching
  its deliberately vacant US and UK chambers. A failed founding-election family
  also makes bootstrap partial or failed instead of silently accepting an
  incomplete world. Founding mode cannot finish if any race lacks a candidate
  or a positive vote tally.

## Changed

- Index funds value every fund's bond holdings with one projected database scan
  per pass and reuse the corporation candidate list for public-float purchases.
  Large historical worlds avoid dozens of repeated full bond and corporation
  reads each turn.
