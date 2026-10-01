---
date: 2026-10-01
title: Protect certified Council mandates during Duma filing
badges: [patch]
areas: [engine, backend]
---

A player with a seated or certified Council mandate cannot enter either Duma
ballot tier before joint chamber seating. First and repeat Duma certification
also excludes owners with seated or pending Council mandates, preserving vacancies
rather than granting a second chamber seat. The check reads the bound Council
receipt once for the whole cohort.
