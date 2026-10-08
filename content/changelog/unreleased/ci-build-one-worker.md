---
date: 2026-10-08
title: Automated builds use one page worker
summary: >-
  Automated builds now generate pages with a single worker and log memory use,
  after two workers still occasionally ran the build machine out of memory.
tags: [ci, reliability]
badges: [patch]
areas: [backend]
---

## What changed

- The automated build check generates pages with one worker instead of two, and records the build machine's memory every 10 seconds so any remaining failures can be diagnosed.
