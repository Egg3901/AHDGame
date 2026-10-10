---
date: 2026-10-09
title: Restore approval conditions for Metrics v2
summary: >-
  National and regional approval now respond to Metrics v2 owner readings.
  Named effects return with updated units, and national breakdowns explain smoothing.
tags: [approval, metrics, balance]
badges: [patch]
areas: [fullstack, engine]
---

## What changed

- Approval in Metrics v2 worlds uses current owner observations for regional comparisons and named conditions.
- Updated conditions account for healthcare coverage, air quality, housing burden, research capacity and retired inputs.
- National effects show population-weighted named conditions and any smoothing adjustment. Regional totals account for effect limits.
- Condition-based sector margins use the same Metrics v2 conditions.
