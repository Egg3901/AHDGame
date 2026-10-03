---
date: "2026-10-01"
title: "Preserve Duma certification inputs for repeat ballots"
badges: [patch]
areas: [engine]
---

New first-Duma certification receipts retain each ballot's frozen register, votes, nomination order and eligibility. Retiring candidacies or later changing party membership cannot rewrite those original inputs. Existing receipts remain readable.

This preserves the inputs needed to keep valid constituency results while rerunning failed ballots. Repeat-generation scheduling and chamber handover are still being implemented.
