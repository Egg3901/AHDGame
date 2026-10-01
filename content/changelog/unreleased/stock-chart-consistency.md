---
date: 2026-10-01
title: Repair stock market charts and returns
summary: >-
  Stock charts now use game-calendar ranges and dates, refresh automatically,
  retain long-history detail, and distinguish live quotes from recorded closes.
  Market returns use starting weights, and incomplete turnover is flagged.
tags: [stock-market, charts]
badges: [patch]
areas: [fullstack]
---

## What changed

- Chart ranges use game months and years, including founding-phase calendar offsets. Bucket tooltips show both start and end dates.
- Long history retains monthly or quarterly detail, includes all recorded turns, and offers logarithmic scaling.
- Live-print candles use one valuation source for all O/H/L/C values. Charts and stock quotes refresh every minute and when the world turn changes. Charts preserve zoom, and quote snapshots revalidate immediately instead of lingering in a shared cache.
- Capitalization changes, price-basket returns, and continuity-adjusted indices are explicitly distinguished. Exchange, sector and grouped-listing returns use starting capitalization weights instead of magnifying winners with ending weights. Only recorded splits adjust historical price bases; issuance is not counted as a split gain.
- Price and volume use identical buckets. Invalid trade records cannot poison turnover totals; incomplete turnover is visibly flagged, and new invalid audit writes are rejected.
- Missing turns, listing coverage changes, constituent removals, and large stored repricings are annotated without smoothing away history.
- Exchange and global-sector comparisons share the chart's ranges, valuation sources, and first-open basis.
