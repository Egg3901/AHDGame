---
date: 2026-09-25
title: Session replay removed; PostHog and Amplitude are the analytics stack
summary: >-
  The OpenReplay session-replay integration is gone. Product events flow to
  PostHog and Amplitude alone through the single consent-gated fan-out, so
  there is one place to reason about what is collected and why.
# Free text. What the change was about: economy, elections, balance, corporations.
tags: [analytics, observability, privacy]
# How big this change is, which sets how it is grouped in the release post.
# One of: major | minor | patch | hotfix
badges: [patch]
# Which part of the codebase moved. Any of: backend | frontend | fullstack | engine
areas: [fullstack]
---

## Removed

- Removed the OpenReplay session-replay integration: the tracking provider, its observability module and tests, the `@openreplay/tracker` dependency, and its environment variables.
- The privacy page no longer carries a separate session-replay disclosure. The analytics disclosure, which covers PostHog and Amplitude, is unchanged.
- PostHog and Amplitude remain the complete analytics stack, both fed by the single `captureProductEvent` fan-out. Removing one destination never suppressed the other.
- PostHog session replay stays disabled.
