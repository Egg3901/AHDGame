---
date: 2026-10-13
title: Mines on empty deposits stop earning for output nobody buys
summary: >-
  Mines whose region holds none of what they extract no longer earn revenue or
  buy inputs for output that never reaches the market. The change phases in
  over 24 turns.
tags: [economy, extraction]
badges: [patch]
areas: [engine]
---

## What changed

- A mine whose region holds none of the resources it is set up to extract used to keep part of its revenue through a transition allowance, even though nothing it produced reached a buyer. That allowance now winds down to zero over 24 turns, so no mine loses its whole revenue in one turn.
- Because such a mine now produces nothing, it also stops buying energy, chemicals and other inputs, which frees those for producers that need them.
- Mines with at least some of their resource in their region are not affected.
