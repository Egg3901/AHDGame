---
date: "2026-10-04"
title: "Search, map and error-reporting reliability"
summary: "Handle invalid search and map requests cleanly and keep routine session cleanup out of error reports."
tags: [reliability, search, maps, observability]
areas: [backend]
badges: [patch]
---

### Fixed

- Search requests with a null character return a validation response before database queries instead of failing inside the database driver.
- Unsupported country map URLs return the missing-page response before loading country identity metadata.
- Expected account deletion and ban enforcement retain their diagnostic breadcrumbs without creating warning issues.
- Next.js render streams closed by a disconnected browser are excluded from error reports only when the exception has the exact framework message, request-error mechanism and a complete framework-only stack. Application frames, incomplete stacks, chained exceptions and write failures remain reported.
