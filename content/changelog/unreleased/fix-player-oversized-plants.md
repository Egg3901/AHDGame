---
date: 2026-10-17
title: Oversized player plants get a warning, then shrink toward their market
summary: A player plant whose buyers take far less than it can make now gets a notice and six turns to act, after which its unused capacity retires a little each turn, as AI plants already did.
tags: [economy, corporations, balance]
badges: [minor]
areas: [fullstack, engine]
---

- A plant counts as oversized when it sells what it makes but its buyers only take under 60% of what it could make. Until now such a plant never shrank, so its owner kept paying for capacity no one could use.
- The first turn a plant is oversized, its CEO gets a notice, and the plant page shows how many turns remain before anything changes.
- After six turns, unused capacity retires a little each turn (4% of the excess), always keeping half again its current run as room to grow. Parked capacity is never retired, so park anything you want to keep.
- State-owned companies are not affected.
