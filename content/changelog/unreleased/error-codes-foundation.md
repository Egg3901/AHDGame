---
date: 2026-10-05
title: Error codes on every failure screen
summary: >-
  Error screens and API failures now carry a short error code and a reference id
  you can quote in a bug report.
tags: [errors, support]
badges: [minor]
areas: [fullstack]
---

## What changed

- Error pages (page not found, server errors, critical errors) now show a plain explanation, an error code, and a copyable reference, with Try again and Home buttons.
- API errors return a code and reference alongside the message, and the reference matches what we see on our side.
