---
date: 2026-09-29
title: Continuous historical monetary calibration
summary: Historical monetary reference rates now graduate between era anchors instead of jumping when an era boundary is crossed.
tags: [economy, history, monetary-policy]
badges: [patch]
areas: [engine]
---

- Preserve authored start-year inflation and neutral-rate references and modern fallback behavior.
- Interpolate reference rates and authored fallback growth between calibration years.
- Actual policy decisions and simulated inflation continue to follow their existing mechanics.
