---
date: 2026-10-01
title: Preserve valid Council results when planning repeat polls
badges: [patch]
areas: [engine]
---

Council repeat planning now replaces only failed subject polls, using new ballot
identities and fresh registers while keeping successful results frozen. A valid
first mandate with a lawful second-seat vacancy is preserved. Repeat counting
cannot grant another subject mandate to an already certified player. Runtime
opening, admission and dispatch integration remain in progress.
