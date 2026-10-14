---
date: 2026-10-14
title: Revenue follows output that actually sells
summary: Adds an operator-started 24-turn phase-in that stops paying producers for output no buyer took.
tags: [economy, corporations, logistics]
badges: [patch]
areas: [engine]
---

- Producers were paid for their whole output even when the delivery network found no buyer for part of it. A new phase-in moves revenue onto the share of output that was actually placed with a buyer, evenly over 24 turns.
- It does nothing until an operator sets its start turn, so it can be sized against live data first.
