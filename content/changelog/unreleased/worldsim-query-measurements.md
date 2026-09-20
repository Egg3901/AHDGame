---
date: 2026-09-20
title: Measure simulation database work correctly
summary: World simulations report actual turn-phase database query counts.
tags: [performance, simulation]
badges: [patch]
areas: [engine]
---

- Sandbox simulations keep local query counters enabled even when remote observability is disabled.
- Optional profiling records returned documents and BSON volume without sending remote telemetry.
