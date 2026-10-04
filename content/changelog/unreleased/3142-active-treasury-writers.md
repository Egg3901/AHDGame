---
date: 2026-10-04
title: Funded extraction receipts
summary: >-
  National extraction fees and prospecting costs can settle from funded
  Treasury cash, with retries reusing the original payment receipt.
# Free text. What the change was about: economy, elections, balance, corporations.
tags: [economy]
# How big this change is, which sets how it is grouped in the release post.
# One of: major | minor | patch | hotfix
badges: [patch]
# Which part of the codebase moved. Any of: backend | frontend | fullstack | engine
areas: [backend]
---

## What changed

- National extraction signing fees and prospecting expenses use durable cash
  receipts when funded Treasury cash is enabled. Failed turn retries resume the
  frozen payment instead of charging again.
