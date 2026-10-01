---
date: "2026-10-01"
title: "Register NPC nominees in Duma repeat rounds"
badges: [patch]
areas: [engine]
---

Repeat rounds register bounded NPC slates against their immutable opening and predecessor. Nominees reuse existing eligible profiles without duplicating characters or personal accounts. Missing party representation is recorded in the round's admission receipt.

All nominee inserts and the admission receipt commit together. A failed late write rolls back the complete batch, and replay creates no additional candidacies. Initial and repeat rounds share the same projected registration path. Automatic opening and chamber handover remain in progress.
