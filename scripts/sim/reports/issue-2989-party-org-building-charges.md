# Issue 2989: party org-building charge qualification

Runtime source: `0e17894c2062e164e580c6684b4d0f187f55a11c`.

The current-source twelve-turn cash diagnostic in #968 reported 61 to 64 state-party
accounts with ledger above cash on turns 4, 8 and 12, the turns the NPP action phase
runs. The NPP org-building sweep pays for organization from the state-party treasury
through `chargeOrgBuildFunds`, which debits `statePartyOrg.treasury` (or the national
party treasury) and recorded only a chair-facing audit row. On turns 8 and 12 every one
of the 64 state-party findings is within 1% of that party's recorded org-building
charge, the difference being exchange-rate drift between the charge and the snapshot.
The turn 4 findings match the same way at that turn's rate (for example 4,629 against
a 4,644 charge).

## Change

- `chargeOrgBuildFunds` publishes the amount actually charged, never the quoted price,
  on the paying `state_party` or `party` account, valued like the balance snapshot,
  against a named `organization_building` sink.
- A missing row, an already-overdrawn treasury or disabled shadow accounting publishes
  nothing. Price, cap, the never-overdraw pipeline and the audit row are unchanged.
- The NPP sweep's existing preload cache carries one accounting context, so a sweep
  loads it once. Player Build Org clicks load it per charge.

## Verified outcomes

The integration file runs four cases against the memory store and the same four
against an isolated local replica-set fixture, plus a sweep-cache check. All 9 pass.
Every reconciled fixture has an unskipped stock check with zero divergences, a green
trial balance and no unattributed entries.

- A 300 GBP state-party charge publishes -600 anchor on the state party and +600 on the
  organization-building sink.
- A treasury holding 100 against a 300 price witnesses exactly the 100 charged.
- A national party charge reconciles with a preloaded context.
- Overdrawn and missing rows publish nothing; with shadow accounting off the treasury
  is still charged and no ledger row is written.

With the witness call removed, all three cash cases fail with one divergence each. The
focused party, NPP organization, action processing, Build Org route, ledger and
transaction-type suites (15 files) pass: 189 passed and 4 native opt-in cases skipped.
Scoped lint, formatting, semantic diagnostics for all 9 changed TypeScript files and the
blocking architecture checks pass.

## Cost and scope

A sweep adds one configuration read and, with shadow accounting on, one rates read,
plus one ledger insert per landed charge. A player click adds the same reads and one
insert. These native fixtures qualify the charge boundary, not the whole world, so
this does not clear #968 or the global cash gate in #2159. No production database was
reset or repaired.
