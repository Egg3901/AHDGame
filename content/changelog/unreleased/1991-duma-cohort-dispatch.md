---
date: "2026-10-01"
title: "Certify Duma election cohorts together"
badges: [patch]
areas: [engine]
---

Bound first-Duma elections wait until every constituency and the national list ballot has completed. Certification uses the existing atomic cohort transaction, and individual races cannot assign officials through the generic election resolver. Failed certification remains available for retry.

Congress remains in place until a separate chamber handover. Repeat elections and Duma/Council handover are still required before the first-Duma opening is connected to the turn loop.
