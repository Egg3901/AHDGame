---
date: 2026-10-01
title: Russian Duma NPC admission and list nominations
badges: [patch]
areas: [engine]
tags: [1991, Russia, elections]
---

The first-Duma NPC admission shell registers bounded nominees against the frozen ballot cohort in one transaction. It preserves player entries, reuses NPC profiles without copying their accounts, excludes conflicting executives and records parties without an eligible NPC representative. Replays preserve the original admission.

National party list primaries retain registered list nominees and NPC fallback capacity together. Constituency nominations retain their normal limit. The generic NPC entry phase leaves bound Duma ballots to the dedicated admission shell.

The remaining vote, repeat-ballot and office handover paths are still being connected before Federal Assembly activation.
