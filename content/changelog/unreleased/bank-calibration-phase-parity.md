---
date: 2026-10-05
title: Bank calibration cash and timing checks
summary: Bank diagnostics track actual opening rates, funded bond claims and annual equity returns.
tags: [banking, economy, diagnostics]
badges: [patch]
areas: [backend]
---

Bank calibration uses the era opening prime rate, pays bank bond claims before
public-float claims, retains unpaid sovereign principal, and stops new coupons
after contractual maturity. It reports full-year income and equity returns
separately and pairs funded household and deposit-insurance cash movements.

The diagnostic uses shared funded sweep, rollover and market-demand rules. It
tracks bill acquisition basis and realized sale or redemption gains, checks
paired cash movements, reconciles income to equity, and applies the production
annual-auction classifier to actual modeled primary fills. The seeded trace
enters `crisisPending` at turn 328, so its 26.91% bank-only neutral return does
not qualify as a full-horizon viability result. Crisis resolution and credit
losses remain unmodeled; this report does not choose a resolution policy.
