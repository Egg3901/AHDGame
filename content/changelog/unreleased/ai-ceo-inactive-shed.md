---
date: 2026-10-16
title: AI-run corporations no longer show the inactive CEO banner
summary: A corporation run by an AI caretaker CEO no longer shows the "Inactive CEO" warning because its owner has been away.
tags: [corporations, caretaker, ui]
badges: [patch]
areas: [fullstack]
---

- The inactive CEO banner and the corporation list's inactive flag now use the same rule as the turn step that sheds sectors. Corporations run by an AI caretaker CEO are excluded, as are autopilot corporations.
- No sector shedding was happening on these corporations. Only the warning was wrong.
