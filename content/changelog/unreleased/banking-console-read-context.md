---
date: 2026-10-07
title: Reduce repeated banking console reads
summary: Reuse charter capital quotes within each banking console request while preserving fresh checks when creating a charter.
tags: [banking, performance]
badges: [patch]
areas: [backend]
---

## What changed

- Calculate the console charter choices from one world preset read and reuse those quotes for eligibility.
