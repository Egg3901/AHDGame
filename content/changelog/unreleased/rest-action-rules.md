---
date: 2026-09-17
title: Shared Rest rules
summary: Rest action cost shares a portable rules module across quote, debit and display.
tags: [actions, singleplayer]
badges: [patch]
areas: [engine]
---

- Rest quotes, effects and validation use the same portable zero-cost rules. Existing balance, always-free and always-eligible behavior is preserved.
- The turn dashboard cost map and the AI advisor read the shared rest cost instead of a hardcoded zero, and the execute shell charges the quoted zero AP through the standard validation path.
