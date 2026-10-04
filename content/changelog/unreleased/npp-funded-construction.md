---
date: 2026-10-04
title: NPP plant financing
summary: >-
  NPP corporations can finance eligible plant orders through charter-approved
  same-currency lenders. Ownership changes preserve secured construction and
  retry-safe market credits until each transition completes.
tags: [banking, manufacturing, corporations]
# How big this change is, which sets how it is grouped in the release post.
# One of: major | minor | patch | hotfix
badges: [patch]
# Which part of the codebase moved. Any of: backend | frontend | fullstack | engine
areas: [backend, engine]
---

NPP build financing is selected in a bounded batch and rechecks lender cash and
charter state atomically when a request is submitted. Pending lender approval
does not add capacity, and unmatched requests remain in the backlog.

Sector sales, privatization, National Corporation restructuring, and country
merges preserve active construction collateral. Foreign-sector market credits
keep a pending receipt until the source row is deleted, so retries after long
interruptions do not add the same property twice.
