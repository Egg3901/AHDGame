---
date: 2026-10-14
title: Commodity price memory reads its own history
summary: The staged commodity correction now reads back the trailing shortage history it saves each turn.
tags: [economy, commodities, markets]
badges: [patch]
areas: [engine]
---

- The commodity price step that follows whether a shortage is worsening or easing now loads its saved trailing history each turn. Before this, the history was saved but never read back, so every commodity price multiplier only eased toward neutral and a deepening shortage could not raise its price.
