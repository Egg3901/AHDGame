# Hungarian modern national-list replacement qualification

Issue: #2488. Runtime source: `36890e7862b1f6693b708354f62b33245c125893`. Executed 2026-10-03. This is bounded transaction and electoral continuity qualification, not a whole-world simulation.

After a modern Assembly handover the old replacement path loaded the earlier386-seat Assembly's slate. The current chamber now selects its own frozen modern receipt and national nomination order. Existing receipt shapes with only stored people derive list order from those original people and certified national mandates or vacancies without rewriting certification. A completed legacy modern settlement without a native modern receipt cannot borrow an older Assembly's list.

The existing party-chair designation, one autonomous NPC designation per turn, original list eligibility, single-player mandate, expiry, chamber lock and replacement journal apply to either chamber. Both affected financial owners' seat counters update with the replacement office and receipt. Private balances are unchanged, no financial actor is cloned, and the original term expiry is retained.

## Verification

All23 isolated-Mongo cases across the earlier and modern Assembly suites pass. The modern journey installs199 physical mandates and preserves12 existing NPC financial owners, then removes a national-list deputy and replaces them with an original nominee owned by a different NPC. Unauthorized chairs and autonomous override of a human chair are rejected. A final replacement-journal failure rolls back the office and both owners' counters. Two concurrent identical designations yield exactly one replacement; replay returns false. Older modern receipt compatibility preserves the stored person order without a database rewrite. Removing the current modern receipt and installing an older native receipt still produces no cross-chamber replacement.

All15 existing portable-list, API and UI cases across three suites pass. Scoped TypeScript, changed-source lint and formatting are qualified separately; the exact-head hosted gate remains required before merge.

## Read cost

The earlier native single replacement remains17 commands. A paired concurrent modern designation measured42 Mongo commands,23,854 command bytes and874,920 reply bytes, including the losing attempt and retry. This is contention qualification, not the cost of every turn. Removing an unnecessary full installed-mandate projection reduced the paired reply payload from1,096,040 bytes with no extra commands. Modern compatibility reconstructs list membership from the projected settled mandates and vacancies.

## Remaining parent criteria

Modern constituency by-elections, joint and linked lists, distinct constituency/list filing, minority nominations, legacy duplicate candidature reconciliation and fresh source-pinned whole-world horizons remain part of #2488 and the broader1991 repair program. This component does not authorize production promotion or close the parent issue.
