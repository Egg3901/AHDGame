---
date: "2026-10-01"
title: "Count native Council ballots and second choices"
badges: [patch]
areas: [engine]
---

Bound Council subject ballots record each valid voter once and each distinct candidate choice separately. First choices use the existing election engine. Optional second choices reuse candidate approval and the existing appeal curve, including choices across associations and independent nominating groups. Voters who reject all available candidates can cast against all.

The frozen register caps participation rather than the larger total of candidate marks. Withdrawal preserves counted marks and nominee registration; snapshots report valid participation and each nominee's voter support. Provisional seat estimates award at most one seat per nominee under the native Council rules. Certification, repeat polls and chamber handover remain in progress.
