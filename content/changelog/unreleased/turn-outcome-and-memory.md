---
date: 2026-10-07
title: Turn logs say whether every step finished
summary: >-
  Each turn log now records whether every step of the turn completed or some
  were skipped by an error, along with how much memory the turn used.
tags: [turns, reliability]
badges: [patch]
areas: [backend]
---

## What changed

- A turn where a step failed is now marked as degraded and lists the steps that did not run, instead of looking the same as a fully completed turn.
- Turn logs record peak memory use, so performance changes can be checked for memory as well as speed.
