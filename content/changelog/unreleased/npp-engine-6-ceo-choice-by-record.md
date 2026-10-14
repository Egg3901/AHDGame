---
date: 2026-10-14
title: "NPP engine 6: NPP-run companies choose CEOs by sector track record"
summary: NPPs now keep a record of how the companies they ran did against sector peers, and at autonomy v6 an NPP-run company prefers a free NPP with a good record in its sector as CEO.
tags: [npp, corporations, autonomy]
badges: [minor]
areas: [backend, engine]
---

## What changed

- Each NPP keeps a CEO track record per operating sector: turns spent running a company there and the company's operating margin against other companies in the same country and sector. Margins are ratios, so the measure is currency-neutral.
- The record is sampled once a game day in the corporation turn, from the sectors the turn already loads, with one read and one batched write. It is bookkeeping and is written at every autonomy level, so a world moved to v6 already has history.
- At autonomy v6, every system-chosen NPP CEO (admin and autonomous NPP corporation spawns, caretakers for vacant corporations, owner-requested caretakers without a named NPP, NPP-run spin-offs and privatization spin-outs) prefers the free NPP with the best good record in the company's sector. A record counts after half a game year and must beat the peers. With no such record the existing party-balanced rule applies.
- A player-named NPP is never overridden. No money or stats change, only who is seated.

## Scope

Worlds below autonomy v6 choose CEOs exactly as before. Production runs v4.

NPP engine version 6.17.0, recorded in the [NPP changelog](/changelog/npp).

- Fix: when an NPP dies (autonomy v5+), its NPP-run companies are marked CEO-vacant in one write, so the caretaker step seats a living NPP next turn. Player companies with a caretaker are left to their owner.
