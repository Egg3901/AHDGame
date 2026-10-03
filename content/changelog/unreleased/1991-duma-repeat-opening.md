---
date: "2026-10-01"
title: "Open failed Duma ballots as atomic repeat rounds"
badges: [patch]
areas: [engine]
---

Repeat opening creates fresh campaigns only for failed constituency and national-list ballots. The complete replacement round and its predecessor receipt commit together, preserving certified results and Congress until chamber handover. Replaying an opening reuses the same round.

New repeat ballots record their original cohort, generation and predecessor. Existing first-generation ballots keep their current shape. Older certification receipts without preserved ballot inputs require verified recovery before repeats can open. Automatic scheduling, repeat certification and chamber handover remain in progress.
