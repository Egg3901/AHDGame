---
date: 2026-09-30
title: UK ministers can take a second title as intended
summary: Appointing a sitting Secretary of State as Deputy Prime Minister or First Secretary of State no longer fails with a conflict error.
tags: [uk, cabinet]
badges: [patch]
areas: [backend]
---

## Fixed

- Appointing a cabinet minister who already runs a department as Deputy Prime Minister or First Secretary of State now works instead of showing "A conflicting appointment was just made".
- When an appointment really cannot be combined with a post the minister already holds, the error now says so plainly.
