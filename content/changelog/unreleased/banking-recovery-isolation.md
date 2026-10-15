---
date: 2026-10-15
title: One stuck payment no longer stops the whole banking turn
summary: When the banking turn finishes payments left over from an earlier turn, a single payment it cannot finish is now set aside and reported instead of stopping deposit interest, loans and every other banking step for the turn.
tags: [banking]
badges: [patch]
areas: [engine]
---

- If one leftover payment from an earlier turn cannot be finished, the banking turn now sets it aside and carries on. Deposit interest, loan servicing and the rest of banking still run for everyone else.
