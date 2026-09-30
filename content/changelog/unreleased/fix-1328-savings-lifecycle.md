---
title: Keep savings accounts consistent through opening and retirement
date: "2026-09-30"
badges: [patch]
areas: [backend]
tags: [banking, savings]
---

Opening savings creates its authoritative account immediately. Full withdrawals
cannot leave a negative balance from floating-point rounding. Retiring or deleting
a character closes savings and releases bank backing through a recoverable
settlement before removing the character.
