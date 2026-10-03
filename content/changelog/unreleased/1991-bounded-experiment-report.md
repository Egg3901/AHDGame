---
title: Long simulation reports respect requested sample limits
date: "2026-10-03"
badges: [patch]
areas: [backend]
tags: [simulation, performance, reports]
---

Simulation report requests now sample timeline data before transferring it from storage. Small requests no longer load unrelated approval and macro telemetry, while incomplete report generations still report an error.
