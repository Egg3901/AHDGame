---
date: 2026-10-07
title: Turn logs record the release that ran them
summary: >-
  Each turn log now records the deployed source it ran on, so turn timings can
  be compared release against release.
tags: [turns, performance, operations]
badges: [patch]
areas: [backend]
---

## What changed

- Every turn log, including crashed turns, records the commit of the deployment that processed it. Turn performance can now be compared between releases exactly.
