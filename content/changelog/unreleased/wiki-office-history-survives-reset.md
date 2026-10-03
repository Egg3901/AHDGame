---
date: 2026-10-03
title: Wiki office history survives world resets
summary: Generated wiki office pages keep every finished world's presidents, cabinet members and congressional leaders instead of starting over at each reset, and office dates follow the founding-phase calendar.
tags: [wiki, reset]
badges: [patch]
areas: [backend]
---

- Archive each office page's tenure list before a reset clears the office tables, and show it as that world's iteration on the page.
- Close the outgoing world's incumbents at its final turn, and drop profile links that would point at retired characters.
- Date office tenures on the founding-phase calendar, which put them a game year ahead of the status bar.
