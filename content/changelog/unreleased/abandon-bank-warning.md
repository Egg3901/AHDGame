---
date: 2026-10-14
title: A warning before abandoning the sectors that power your bank
summary: Abandoning a financial sector now shows what it does to your bank's deposit ceiling and asks you to confirm.
tags: [banking, corporations, sectors]
badges: [patch]
areas: [fullstack]
---

- A bank's deposit ceiling comes from its company's financial sectors. Abandoning one now shows the ceiling before and after, and the deposits the bank holds, and asks you to confirm. Abandoning the last one warns that the ceiling falls to zero and deposits drain away each turn.
- The deposit ceiling tooltip on the bank page now says where its capacity comes from.
- Abandoning from a sector's own page now shows an error when it fails, instead of doing nothing.
