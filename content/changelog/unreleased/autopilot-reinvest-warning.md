---
date: 2026-10-16
title: Autopilot reinvests gradually and only when builds pay back
summary: >-
  A corporation on autopilot now adds new plant capacity in small steps and
  only where the plant is already profitable and the build should repay itself.
  Turning autopilot on now explains this and asks you to confirm.
tags: [corporations, autopilot, economy]
badges: [patch]
areas: [fullstack, engine]
---

## What changed

- Autopilot adds at most 5% to any one plant per build, keeps one growth order in flight per plant, and commits at most 15% of the cash above the reserve to new capacity each turn.
- Autopilot only builds where the plant made a profit last turn, sells nearly everything it makes, the market has room, the corporation's earnings are positive, and the extra output should repay the cost within 30 turns of coming online.
- Switching autopilot on shows a confirmation explaining that it may spend part of the corporation's cash on new plants. While it is on, the Overview shows what it may spend and a button to turn it off.
- The wiki entry for autopilot describes the gradual, payback-gated reinvestment.
