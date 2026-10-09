---
date: 2026-10-09
title: NPP product ventures qualify on operating income
summary: "Computer-run companies can start eligible product ventures when their operating income supports the funding and they retain a small cash buffer."
tags: [products, corporations]
badges: [patch]
areas: [backend]
---

## What changed

Computer-run companies can start eligible product ventures when their operating income supports the funding and they retain a small cash buffer.

## Developer detail

Eligibility fixes in #3618 were followed by income-based qualification in #3650. Current selection requires last-settled profit to cover two standard funding steps and two funding steps of cash above reserve; below fourfold profit cover it selects the lean tier. This replaces the earlier 12-turn cash runway. Existing venture feature gates still apply. References: 71919a7ee0, 072978b568.
