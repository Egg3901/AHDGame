---
date: 2026-09-26
title: Simplify stock market chart and fix loading
summary: >-
  The stock market chart now loads reliably and stays readable on small screens.
  Its time axis shows game turns, and corporate event labels no longer cover the candles.
# Free text. What the change was about: economy, elections, balance, corporations.
tags: [stock-market, chart]
# How big this change is, which sets how it is grouped in the release post.
# One of: major | minor | patch | hotfix
badges: [patch]
# Which part of the codebase moved. Any of: backend | frontend | fullstack | engine
areas: [frontend]
---

## What changed

- Keep the chart mounted while market history loads, with a fixed-height loading state.
- Remove crowded event markers and show game turns and compact market values on the axes.
