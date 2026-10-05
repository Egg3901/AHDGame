---
date: 2026-10-04
title: Restore economy startup guards after a fresh reset
badges: [patch]
areas: [backend]
tags: [banking, manufacturing, media]
---

- Restore required banking, product and media indexes even when a reset preserves migration history.
- Initialize missing bond market pools in a fresh 1991 world without refilling existing pools or healing older worlds.
- Preserve separate news and entertainment markets when restoring uniqueness guards.
