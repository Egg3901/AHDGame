---
date: 2026-09-30
title: Preserve fund orders when a response is lost
summary: Fund subscription and redemption retries retain the original order and result.
tags: [economy, bugfix]
badges: [patch]
areas: [fullstack]
---

- Fund orders carry a unique ID. Retrying an order returns its recorded result instead of placing it again; a new intentional order receives a fresh ID.
- Unconfirmed orders keep their original quantity and payment choice. The form explains that cash or units may already have moved and shows the order ID for support.
- Interrupted standalone settlements with an unknown outcome remain pending instead of being silently repeated.

Completed fund orders also repair missing financial audit records on retry without moving cash or units again.
