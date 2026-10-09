---
date: 2026-10-09
title: Show market price freshness on the real clock
summary: "The stock-price freshness label uses the real market update time, even when the game calendar is ahead."
tags: [markets, interface]
badges: [patch]
areas: [frontend, backend]
---

## What changed

The stock-price freshness label uses the real market update time, even when the game calendar is ahead.

## Developer detail

Both market updates and the hourly price path publish lastMarketTickAt. The status bar uses that wall-clock marker instead of comparing it with the game-clock lastTurnProcessed. Includes a fake-clock UI regression. References: #3675, commit 6383fd67ac.
