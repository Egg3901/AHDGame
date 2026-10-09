---
title: Reliable support ticket closure retries
date: 2026-10-09
badges: [patch]
areas: [backend]
tags: [support, reliability]
---

Closing the same support ticket again preserves its original receipt version and records one closure event. Concurrent retries acknowledge the stored outcome, and delivery timestamps retain their exact precision so a receipt already posted is not sent again. If a ticket changes while a close is being saved, the bot must retry rather than treating the change as a completed close.
