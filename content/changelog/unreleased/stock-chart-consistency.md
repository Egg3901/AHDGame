---
date: 2026-09-30
title: Fix stock chart ranges and capitalization
summary: >-
  Stock candles now use consistent live market values, and chart changes follow
  the selected range. Daily buckets and logarithmic scaling make full history
  readable, with aligned turnover and visible intraday coverage.
tags: [stock-market, charts]
badges: [patch]
areas: [fullstack]
---

## What changed

- Candles with intraday prints use those prints for open, high, low and close.
- Range changes compare the first open with the last close, including the preceding turn when available.
- Month and shorter full-history views use daily buckets; longer history uses weekly buckets. Full history includes all recorded turns.
- Full-history and yearly views default to a logarithmic scale, with a linear scale toggle.
- Volume uses the same candle buckets and chart pane. Intraday coverage counts underlying turns and marks where live prints begin.
