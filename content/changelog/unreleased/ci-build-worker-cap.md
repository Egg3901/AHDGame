---
date: 2026-10-08
title: More reliable automated builds
summary: >-
  Automated builds use fewer parallel workers so they no longer run the build
  machine out of memory.
tags: [ci, reliability]
badges: [patch]
areas: [backend]
---

## What changed

- The automated build check now generates pages with two workers instead of three. About one build in five was failing because the build machine ran out of memory, which delayed releases.
