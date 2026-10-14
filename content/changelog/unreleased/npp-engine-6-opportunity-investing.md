---
date: 2026-10-14
title: "NPP engine 6: NPPs trade on market opportunity"
summary: At autonomy v6, an NPP's chance to buy stock or bonds, or to trim a share position, scales with how good the opportunity is, normalized so the expected number of trades is unchanged.
tags: [npp, equities, bonds, autonomy]
badges: [minor]
areas: [backend, engine]
---

## What changed

- At autonomy v6, the stock and bond buy sweeps score the market before an NPP decides, instead of rolling a flat chance first.
  - Stock: the best fundamental-to-price ratio on offer over the NPP's own value floor, squared.
  - Bond: the best current yield over the 1% yield floor, square-rooted.
  - The base chance (stock 0.075, bond 0.05, times risk tolerance) becomes base times a multiplier proportional to that score, capped at 2.
- The stock sell sweep responds to overvaluation more sharply: the engine 5 price ratio multiplier is replaced by the cubed ratio of price to fundamentals, capped at the engine 5 ceiling of 2.5.
- Volume is held: the multipliers are scaled across everyone deciding in the sweep so the expected number of purchases (or sales) equals the engine 5 expectation on the same candidates. A cheap market draws more of the buying and a dear one less; the total does not grow.
- NPPs with nothing worth buying hold their cash, as before. Candidate choice, trade size, float reserves and the CEO stake exclusion are unchanged.
- Pure rules in `src/lib/nppAutonomy/v6/rules/opportunityInvesting.ts`.

## Scope

Worlds below autonomy v6 are unchanged; a fixture test pins their decisions. Production runs v4.
