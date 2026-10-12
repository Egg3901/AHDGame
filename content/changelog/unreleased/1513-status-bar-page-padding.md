---
date: 2026-10-12
title: Bottom of the page no longer hidden under the status bar on phones
summary: >-
  On phones in portrait, the last row of a page could sit under the status bar
  at the bottom of the screen with no way to scroll to it.
tags: [interface, mobile]
badges: [minor]
areas: [frontend]
---

## What changed

- Pages now leave exactly as much room at the bottom as the status bar takes up. On a phone held upright the bar wraps onto two lines, and pages without a footer, like the moderation panel, ended with their last controls (such as Next page) stuck underneath it. They now scroll fully into view.
