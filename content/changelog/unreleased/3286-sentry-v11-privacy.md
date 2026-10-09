---
date: 2026-10-07
title: Update error monitoring while preserving privacy filters
summary: The Sentry SDK upgrade keeps restricted data collection and existing error filters across browser, server and edge monitoring.
tags: [observability, dependencies, privacy]
badges: [patch]
areas: [fullstack]
---

- Upgrade the Sentry Next.js SDK to version 11 with explicit collection restrictions in all three runtimes.
- Keep transaction filters active and discard SDK logs. Existing error-event scrubbing remains enabled.
- Match the application's supported Node versions to the installed SDK requirements.
