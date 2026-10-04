---
date: 2026-10-04
title: Safe handling of unrecognized sector types
summary: Unrecognized saved sector types no longer crash strategy resolution during turns.
tags: [corporations, economy, reliability]
badges: [patch]
areas: [engine]
---

- Use empty production rates for unrecognized saved sector types and report each type once.
- Log counts of unrecognized sector types at server and turn-worker startup.
- Preserve existing media and entertainment strategies and known-sector strategy fallbacks.
