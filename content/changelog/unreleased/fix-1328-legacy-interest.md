---
title: Recover interrupted legacy savings interest batches
date: "2026-09-30"
badges: [patch]
areas: [backend]
tags: [banking, savings, settlement]
---

Legacy bank savings interest keeps its original recipient amounts and transaction
records through an interruption. Recovery finishes unpaid recipients without
paying earlier recipients twice, and savings interest remains a batched operation.
