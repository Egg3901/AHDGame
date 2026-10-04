---
date: 2026-10-04
title: Release integration checks
badges: [patch]
areas: [backend, engine]
tags: [validation, banking]
---

Restore compiler and regression checks after the construction-finance integration.
Ownership fixtures now verify the guarded sector writes, and the bank calibration
harness validates seed inputs without changing its model output. Corporation
decisions move into a separate module while preserving their existing behavior.
