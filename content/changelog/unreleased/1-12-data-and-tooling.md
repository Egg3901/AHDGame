---
date: 2026-10-05
title: Data and tooling
summary: >-
  Fresh worlds start with every feature on, resets are validated first, and simulation reporting and release checks are broader.
tags: [reset, flags, tooling, docs]
badges: [minor]
areas: [backend, engine]
---

## What changed

- A first start or reset turns every gameplay feature on, except autonomous politicians, which start at v4 instead of v5. Running worlds are unchanged.
- Resets check the full configuration and database target before tearing anything down, and restore required banking, product and media indexes and bond pools.
- Admin gets separate version controls for metrics, legislation and Cabinet.
- Simulation runs record per-turn macro, fiscal, trade and securities history, with a bounded admin export.
- Bank calibration and release checks cover banking, underwriting, sector and media behavior.
- Large code modules were split with no change to gameplay, and the README and contributing guide match the current process.
