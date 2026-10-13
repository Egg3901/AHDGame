---
date: 2026-10-13
title: Clearer message when a corporation page can't load
summary: >-
  If the server briefly can't answer while a corporation page loads, the page
  now says the service is unavailable instead of showing a generic error.
tags: [corporations, interface]
badges: [minor]
areas: [frontend]
---

## What changed

- When the server returns an empty or garbled error while a corporation page is loading or refreshing, the page now shows a plain "service unavailable" style message with its error code, instead of a generic failure. Refreshing the page once the server is back works as before.
