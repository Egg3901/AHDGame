---
date: 2026-10-07
title: Record turn phase starts before changing the world
summary: Turn recovery retains evidence of phases that started between telemetry updates.
tags: [turns, recovery]
badges: [patch]
areas: [engine]
---

Turn phases persist their start before applying changes. A failed start write stops that phase, and a delayed heartbeat cannot overwrite a failed phase status. Recovery can therefore recognize interrupted work even when the process stops between telemetry updates.
