---
date: 2026-10-15
title: Keep IMF chairmanship separate from personal corporation navigation
summary: >-
  Chairing the IMF no longer replaces your business in corporation navigation,
  your profile, or live status panels.
tags: [corporations, imf]
badges: [patch]
areas: [backend]
---

## What changed

- Personal corporation lookups exclude the IMF institution, so holding both roles keeps your business selected.
- Regression coverage checks both corporation record orders, an IMF chair without a business, and a vacant business CEO seat.
