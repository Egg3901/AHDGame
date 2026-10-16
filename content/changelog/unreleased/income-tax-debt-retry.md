---
date: 2026-10-16
title: Retry older unpaid income taxes while new income arrives
summary: Outstanding income-tax liabilities stay eligible for collection as players receive new earnings.
tags: [income-tax, budgets, player-finances]
badges: [patch]
areas: [backend, engine]
---

- Revisit older unpaid income taxes even when each turn creates new assessments, while keeping the collection scan bounded.
- Use the same exchange-rate fallback for unpaid tax in personal statements and wealth calculations.
- Calibrate tax-phase database-call budgets against observed live turn telemetry.
