---
date: 2026-10-09
title: Support tickets stop asking for a page you already gave us
summary: >-
  A new ticket no longer asks you for a page link just because you picked web
  browser or mobile as your platform, and it skips the question when your
  recent visits already point at the page.
tags: [support, tickets]
badges: [patch]
areas: [backend]
---

## What changed

- The platform you pick when opening a ticket is no longer read as part of your report, so choosing web browser or a mobile option does not trigger a request for a page link.
- When your recent game visits already suggest the page, the ticket asks you to confirm that page in one tap instead of asking you to paste a link.
