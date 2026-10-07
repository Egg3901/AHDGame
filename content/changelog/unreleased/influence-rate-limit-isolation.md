---
date: 2026-10-07
title: Keep party influence request limits separate from unrelated actions
summary: >-
  Unrelated requests no longer consume the party influence request allowance.
tags: [parties, reliability]
badges: [patch]
areas: [backend]
---

National and regional party influence continue to share a limit of 20 requests
per minute per account. Other API actions no longer consume that allowance.
