# 1991 Russian direct-ballot matched-seed qualification

Date: 2026-10-01

Command:

```bash
node --import tsx scripts/sim/1991-russian-presidential-fixture.ts
```

The bounded rules simulation ran 384 scenarios over 32 matched preference seeds, four turnout levels (25%, 50%, 75%, 100%) and three campaign-strength levels (0, 50,000, 150,000). Each scenario counts two fresh vote increments against one million registered voters. The existing campaign-strength curve is reused; its constants are unchanged.

All scenarios conserved the target participation exactly. Strength increased the supported candidate's votes within that fixed pool. All 96 low-turnout scenarios required a repeat ballot. The remaining scenarios produced 96 runoffs and 192 first-round majority winners. No minority or low-turnout first ballot elected a president.

This qualifies the portable participation, campaign redistribution and first-ballot decision rules together. It is a bounded rules fixture, not a full-world simulation or a database-transaction qualification. Hosted replica-set tests and complete 1991 world horizons are separate gates.
