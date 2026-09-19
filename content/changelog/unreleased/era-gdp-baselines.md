---
date: 2026-09-17
title: Country and era aware campaign GDP baselines
summary: Campaign income and action costs scale against a per-country, per-era GDP baseline.
tags: [actions, campaigns, balance]
badges: [patch]
areas: [engine]
---

- Campaign income and Campaign, Advertise, and Build Donor Network costs resolve a national GDP-per-capita baseline for the world's country and era instead of a single modern value, so historical worlds price in their own denomination.
- The actions page quotes the world's reset preset, matching the cost the server charges at execution.
- Countries without an explicit baseline fail loudly instead of silently inheriting a mismatched denomination.
