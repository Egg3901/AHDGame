---
date: 2026-10-15
title: Steadier pages during brief outages, and working new-tab links in the app
summary: Dropped connections and brief server restarts now show a retry message, new-tab links open from the desktop and mobile app, and Cabinet funding boxes no longer crash while typing.
tags: [reliability, client, cabinet]
badges: [patch]
areas: [fullstack]
---

- A dropped connection, a timeout, or a brief server restart while loading a corporation or your portfolio now shows a retry message instead of an error code to report.
- In the desktop and mobile app, links that open in a new tab now open in your browser again instead of doing nothing.
- Typing a Cabinet program request outside 0 to 200, or with decimals, no longer breaks the department funding panel. The box shows what it accepts and saving waits until the number is valid.
- After a region secedes, each department program keeps its Cabinet funding request instead of having it scaled down.
