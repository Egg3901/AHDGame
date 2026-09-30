---
date: 2026-09-30
title: Reset reports blocked seed readiness
summary: >-
  Critical seed checks and audit errors now mark reset readiness as blocked,
  with failing checks visible instead of a successful completion banner.
tags: [reset, seed, reliability]
badges: [patch]
areas: [fullstack, engine]
---

## What changed

- Critical conformance checks make the reset record partial and remain visible in its failure list.
- JSON and streaming reset results expose seed readiness and critical checks; blocked readiness shows an error banner in reset controls.
- Audit and baseline errors cannot yield a healthy result. Skipped audits are explicitly not checked.
- Healthy audited resets still capture a baseline. Maintenance remains enabled until a separate operator acceptance step.
