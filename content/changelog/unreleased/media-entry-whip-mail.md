---
date: 2026-10-09
title: Prevent duplicate media entry and streamline whip messages
summary: "Media entry avoids duplicate setup, and party whip messages reach players through a batched delivery path."
tags: [media, parties, reliability]
badges: [patch]
areas: [backend]
---

## What changed

Media entry avoids duplicate setup, and party whip messages reach players through a batched delivery path.

## Developer detail

Media entry guards and bulk system-mail delivery reduce duplicate work and per-recipient writes. Delivery tests cover distinct recipients and empty batches. References: #3626, commit fe79c322d6.
