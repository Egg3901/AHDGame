---
date: 2026-10-01
title: Preserve prepared sandbox settings during simulation
summary: Continue a verified prepared sandbox without replacing its opening configuration.
tags: [simulation, reset, validation]
badges: [patch]
areas: [engine, backend]
---

- Verify the prepared sandbox's configuration, clock, baseline and seed health before starting its simulation.
- Preserve its parties, actor population and gameplay settings, and report the actual autonomy level.
- Allow an explicit queue priority while preserving original queue timestamps and one-worker admission.
