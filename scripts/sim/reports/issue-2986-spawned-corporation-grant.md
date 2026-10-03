# Issue 2986: spawned corporation starting grant qualification

Runtime source: `ea4b3cce13be0d65d443d903af0d7f75af4554de`, rebased onto #2984 and requalified.

The current-source twelve-turn cash diagnostic in #968 reported every corporation
spawned during the run as a created account whose cash exceeded its ledger by its
whole starting treasury, about 2M anchor each (about 312M anchor for a Nigerian
spawn, whose grant size is tracked separately in #2985). For spawns that also
founded a sector, the already-witnessed founding expense explained the rest: ledger
equals grant minus founding expense.

`spawnNppCorporation` inserts each new corporation with `liquidCapital` set to a
system-granted starting treasury, separate from any founder's fee, and published no
ledger witness for it. Every spawn path uses this function: NPP corporation founding,
NPC bank seeding, extraction auto-spawn and the admin spawn tools.

## Change

- After the insert lands, the grant publishes one named mint
  (`corporation_starting_grant`) on the corporation's cash account for exactly the
  inserted amount, valued at the snapshot's exchange rate with the same missing-rate
  fallback.
- The witness carries the founding turn when the caller supplies it, otherwise the
  game clock.
- A failed insert, zero capital or disabled shadow accounting publishes nothing.
- The grant's size, share allocation and every other spawn outcome are unchanged.

## Verified outcomes

The integration file drives the actual spawn function four ways against the memory
store and the same four against an isolated local replica-set fixture. All 8 pass.
Every reconciled fixture has an unskipped stock check with zero divergences, a green
trial balance and no unattributed entries.

- A default GBP grant reconciles at the founding turn, not a stale game clock, with
  the enterprise leg valued at the snapshot rate.
- An explicit USD capital stays literal and reconciles at the game clock.
- Disabled shadow accounting keeps the capital and writes no ledger rows.
- A failed insert creates no corporation and no ledger row.

With the witness call removed, both cash cases fail with one divergence each, so the
fixtures detect the defect. The focused spawn, banking, extraction, bootstrap, ledger,
transaction-type and treasury suites (22 files) pass: 288 passed and 12 native opt-in
cases skipped. Natively, this file and the treasury integration file pass 24 of 24. Scoped lint, formatting, semantic diagnostics for all 6 changed TypeScript
files and the blocking architecture checks pass.

## Cost and scope

Each spawn adds one configuration read, and when shadow accounting is on one game
state read (only without an explicit turn), one exchange-rate read and one ledger
insert. Spawns already issue dozens of reads and writes.

These native fixtures qualify the spawn boundary, not the whole world. Whole-world
residuals remain visible until a fresh run qualifies them, so this does not clear
#968 or the global cash gate in #2159. No production database was reset or repaired.
