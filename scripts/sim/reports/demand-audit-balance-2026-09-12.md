# Demand audit balance report, 2026-09-12

Command: `npx tsx scripts/sim/demandAuditBalance2026-09-12.ts`

This focused deterministic sweep covers the changed demand constants. It does
not claim a full-world equilibrium result; that remains a staging-promotion
check after the rules merge into `development`.

## Advertising demand

| Funded budgets vs anchor | Demand factor vs linear | Demand value at that scale |
| -----------------------: | ----------------------: | -------------------------: |
|                   0.005% |                   4.417 |                     39,755 |
|                       1% |                   1.995 |                  3,591,472 |
|                      50% |                   1.110 |                 99,861,252 |
|                     100% |                   1.000 |                180,000,000 |
|                     200% |                   0.901 |                324,450,167 |
|                   1,000% |                   0.708 |              1,274,302,412 |

Demand remains positive and monotonic across the sweep. The factor is large in
tiny fixture worlds, but total demand still approaches zero with budgets
because the resulting demand has elasticity 0.85. The 4.4x small-world factor
is therefore explicit and accepted rather than described only by the 0.5x to
2x live-scale band.

## Building materials

At reference GDP 1e12, the new 0.0002 GDP buyer contributes 500,000 units before
the existing ledger unit scale. This is linear in GDP and zero at zero GDP.

## Operational boundaries

- Hidden demand affects read-only build signals, not price formation, clearing,
  margins, or plant writes.
- Government regional routing is restricted to healthcare and ordnance. The
  planned-economy state-media buyer remains national and global only.
- Cost mothballing requires 12 consecutive losing turns, excludes extraction
  and state-owned corporations, and consumes the existing one-change budget.
