---
date: 2026-10-03
title: Faster front page load and working site analytics
summary: >-
  The front page globe waits for the page to finish loading before it spins,
  slows itself on weaker devices, and logged-out visitors no longer trigger
  account requests that can only fail.
tags: [landing, performance, analytics]
badges: [patch]
areas: [frontend]
---

## What changed

- The front page globe stays still for the first moments after the page loads, so the headline and buttons appear sooner, then starts spinning once the page is idle.
- If the globe's frames run slow on a device, it drops to a lower frame rate on its own instead of holding the page up.
- The globe writes shorter map outlines each frame.
- Visitors who are not signed in no longer request their alerts, character status or tutorial progress, which could only fail.
- The site logo in the navbar loads straight away instead of waiting.
- Site analytics point at the current analytics server. Page views had stopped recording after the analytics address moved.
- Search engines can read robots.txt and the sitemap while the game is in maintenance.
