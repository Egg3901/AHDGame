---
date: 2026-10-14
title: Plants read local input availability
summary: Plants are no longer throttled by national freight and service shortages when their own state has enough.
tags: [economy, commodities, markets]
badges: [patch]
areas: [engine]
---

- A plant's freight and local service inputs are now judged against its own state's market, so a national shortage no longer throttles it when its state has enough supply.
- Internal supply can no longer make a plant's input availability worse than its state market. It can still improve availability above that figure.
