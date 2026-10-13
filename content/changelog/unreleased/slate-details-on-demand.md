---
date: 2026-10-13
title: Load slate details on demand
summary: >-
  Slate cards now load candidate assignments when opened, reducing detail requests
  for parties with many races while keeping each race's current controls available.
tags: [elections, recruitment]
badges: [patch]
areas: [frontend]
---

## What changed

- Race cards start with their overview and load candidate assignments when opened. Closing a loaded card keeps its data available for reopening.
