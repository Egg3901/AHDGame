---
date: 2026-09-17
title: Shared Debate Prep rules
summary: Debate Prep action cost, odds and eligibility share a portable rules module across quote, gate and display.
tags: [actions, singleplayer]
badges: [patch]
areas: [engine]
---

- Debate Prep quotes, effects and the execute gate use the same portable AP, chance and eligibility rules. Existing balance, the flat 1 AP cost and the fixed success chance are preserved.
- The execute shell gates through the shared quote, and validation rejects a disabled stat system or a missing stat block with the quote reason instead of charging for a roll that cannot land.
- The action definition and the UI card derive their advertised odds from the resolved chance constant, fixing a drift where the text advertised 10% while the roll resolved 15%.
