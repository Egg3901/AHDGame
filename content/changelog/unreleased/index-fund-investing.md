---
date: 2026-10-09
title: Simpler fund pages and corporate fund investing
summary: >-
  Fund pages put trading first and paginate holdings and subscribers. CEOs can
  invest corporation cash in funds, with holdings valued on the balance sheet.
tags: [index-funds, corporations, investments]
badges: [minor]
areas: [fullstack]
---

## What changed

- Buy and redeem actions sit beneath the fund header and open a purchase dialog with personal and corporation account choices.
- Holdings have their own tab. Constituents, bond holdings and subscriber lists show ten rows per page; fund statistics wrap on mobile.
- Corporate purchases debit the corporation's liquid capital in its currency. Corporate redemptions pay available unreserved fund cash; otherwise the units remain invested.
- Corporate fund positions contribute current NAV value to portfolio assets, book value and equity, and link to the held funds from the balance sheet.
- Corporate dividends and wind-up distributions credit corporate cash. Orders preserve idempotent receipts and durable financial audit records.
