---
date: 2026-10-16
title: Stock holding terms and tiered capital gains taxes
summary: >-
  Direct corporation shares now have separate Short Term Holdings and Long Term
  Holdings. Dividends and positive sale profits use income tax before 48 turns
  and independently legislated capital gains tax after 48 turns.
tags: [corporations, economy, taxation]
badges: [minor]
areas: [fullstack, engine]
---

## What changed

- Choose which holding bucket to sell from, and see when short-term purchases become long term.
- Purchase cost and sale losses are exempt from both taxes. Index-fund units and distributions keep their existing treatment.
- Capital gains tax has independent Low Income, Medium Income, and High Income bill provisions.
- Existing direct shares enter Long Term Holdings. The rollout preserves recorded costs, reconstructs purchase history where possible, and uses a frozen rollout price for unknown cost basis.
- The migration initializes each capital gains rate from its corresponding current income tax rate.

- Collected personal income and capital gains taxes immediately credit the applicable regional balance and national Treasury, independently of annual budget projections. Ledger replay preserves the original settlement witness.

- See combined, short-term and long-term stock values in your portfolio, filter your holdings by bucket, and switch the existing history chart between stock buckets. Bucket history begins with measured snapshots after activation.
