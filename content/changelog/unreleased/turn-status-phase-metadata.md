---
date: 2026-09-20
title: Load turn progress without loading election processing
summary: Turn progress uses lightweight phase metadata.
tags: [performance, turns]
badges: [patch]
areas: [backend]
---

- The turn status endpoint reads phase names without importing election and government processing implementations.
- Registry checks keep progress metadata aligned with every country phase.
