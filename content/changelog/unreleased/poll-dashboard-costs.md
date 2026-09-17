---
date: 2026-09-17
title: Shared Poll dashboard costs
summary: Turn dashboard poll costs derive from the portable Poll rules.
tags: [actions, singleplayer]
badges: [patch]
areas: [engine]
---

- The turn dashboard `actionCosts` map reads `poll` / `pollLarge` from the shared `getPollActionCost` owner instead of restating 2/6. Existing balance is preserved.
- Adds dashboard parity tests proving a test-only canonical Poll cost move flows through to the dashboard response.
