---
date: 2026-10-16
title: Share trades no longer shrink company share totals
summary: Trades no longer rewrite a company's issued share count while another holder's sell order is being placed or cancelled.
tags: [corporations, shares]
badges: [patch]
areas: [backend]
---

- A trade that landed while another holder was placing or cancelling a sell order could reduce the company's issued share count, leaving its shareholders adding up to more than 100%. Trades now only check the share count and no longer rewrite it.
