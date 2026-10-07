---
date: 2026-10-08
title: Plan simulation evidence against change risk and compute budgets
summary: >-
  Simulation planning now records matched source pins, explicit horizons and
  engine budgets before optional overnight queue submission.
tags: [simulation, qualification, performance]
badges: [minor]
areas: [backend]
---

Presentation-only changes can avoid full worldsims. Runtime changes require
bounded baseline and candidate evidence; declared cycles extend the horizon.
Over-budget and unavailable aged-state plans remain explicitly blocked.
Accepted reports can be reused only with matching execution fingerprints.
Budgeted queued runs stop their owned engine process group on expiry and remain
unqualified. Existing release gates still apply.
