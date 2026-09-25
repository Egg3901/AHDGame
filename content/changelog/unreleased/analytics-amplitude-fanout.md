---
date: 2026-09-25
title: One analytics wrapper feeding PostHog and Amplitude
summary: >-
  Product events now flow through a single consent-gated fan-out, so the
  onboarding and retention funnels reach both analytics tools without any
  call site knowing which ones are enabled.
# Free text. What the change was about: economy, elections, balance, corporations.
tags: [analytics, observability]
# How big this change is, which sets how it is grouped in the release post.
# One of: major | minor | patch | hotfix
badges: [patch]
# Which part of the codebase moved. Any of: backend | frontend | fullstack | engine
areas: [fullstack]
---

## What changed

- Product events fan out from one `captureProductEvent` choke point to both PostHog and Amplitude.
- Amplitude receives the same consent-gated stream, giving retention and cohort analysis a dedicated tool.
- Withdrawing analytics consent stops both destinations, not just PostHog.
- A destination whose key is not configured is a silent no-op, so either tool can be provisioned independently without suppressing the other.
